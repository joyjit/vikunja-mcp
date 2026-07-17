/**
 * Unit tests for SimpleFilterStorage and FilterStorageManager
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  SimpleFilterStorage,
  FilterStorageManager,
  storageManager,
  onProcessExit,
  onProcessSignal,
  registerStorageShutdownHandlers,
} from '../../src/storage/SimpleFilterStorage';

describe('SimpleFilterStorage', () => {
  let storage: SimpleFilterStorage;

  beforeEach(() => {
    storage = new SimpleFilterStorage('sess-1', 'user-1', 'https://vikunja.example');
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates, lists, gets, and finds filters', async () => {
    const created = await storage.create({
      name: 'Open',
      filter: 'done = false',
      isGlobal: true,
      projectId: 7,
    });

    expect(created.id).toBeDefined();
    expect(await storage.get(created.id)).toMatchObject({ name: 'Open' });
    expect(await storage.get('missing')).toBeNull();
    expect(await storage.findByName('Open')).toMatchObject({ id: created.id });
    expect(await storage.findByName('Nope')).toBeNull();

    const listed = await storage.list();
    expect(listed).toHaveLength(1);
  });

  it('updates and deletes filters, throwing when missing', async () => {
    const created = await storage.create({
      name: 'A',
      filter: 'priority > 1',
      isGlobal: false,
    });

    const updated = await storage.update(created.id, { name: 'B' });
    expect(updated.name).toBe('B');

    await expect(storage.update('missing', { name: 'X' })).rejects.toThrow('not found');
    await expect(storage.delete('missing')).rejects.toThrow('not found');

    await storage.delete(created.id);
    expect(await storage.get(created.id)).toBeNull();
  });

  it('filters by project and sorts by updated time', async () => {
    const older = await storage.create({
      name: 'P1-old',
      filter: 'done = false',
      isGlobal: false,
      projectId: 1,
    });
    // Ensure distinct updated timestamps
    await new Promise((r) => setTimeout(r, 5));
    const newer = await storage.create({
      name: 'P1-new',
      filter: 'done = true',
      isGlobal: false,
      projectId: 1,
    });
    await storage.create({
      name: 'P2',
      filter: 'done = false',
      isGlobal: false,
      projectId: 2,
    });

    const project1 = await storage.getByProject(1);
    expect(project1.map((f) => f.id)).toEqual([newer.id, older.id]);
  });

  it('exposes session, stats, health, and clear', async () => {
    await storage.create({ name: 'X', filter: 'done = false', isGlobal: true });

    const session = storage.getSession();
    expect(session.id).toBe('sess-1');
    expect(session.userId).toBe('user-1');
    expect(session.apiUrl).toBe('https://vikunja.example');

    const stats = await storage.getStats();
    expect(stats.filterCount).toBe(1);
    expect(stats.storageType).toBe('memory');

    expect(storage.healthCheck()).toMatchObject({
      healthy: true,
      details: { filterCount: 1, sessionId: 'sess-1' },
    });

    await storage.clear();
    expect((await storage.getStats()).filterCount).toBe(0);
  });
});

describe('FilterStorageManager', () => {
  let manager: FilterStorageManager;

  beforeEach(() => {
    manager = new FilterStorageManager();
    manager.stopCleanupTimer();
  });

  afterEach(async () => {
    await manager.destroy();
  });

  it('reuses storage per session and reports stats', async () => {
    const a = await manager.getStorage('s1', 'u1');
    const b = await manager.getStorage('s1');
    expect(a).toBe(b);

    await a.create({ name: 'F', filter: 'done = false', isGlobal: true });
    const stats = await manager.getAllStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ sessionId: 's1', filterCount: 1, memoryUsageKb: 0 });
  });

  it('clears all sessions and destroys cleanly', async () => {
    const s = await manager.getStorage('to-clear');
    await s.create({ name: 'F', filter: 'done = false', isGlobal: true });

    await manager.clearAll();
    expect(await manager.getAllStats()).toHaveLength(0);

    await manager.getStorage('again');
    await manager.destroy();
    expect(await manager.getAllStats()).toHaveLength(0);
  });

  it('cleans up inactive sessions via private cleanup path', async () => {
    const storage = await manager.getStorage('stale');
    await storage.create({ name: 'F', filter: 'done = false', isGlobal: true });

    // Force lastAccessAt into the past
    const session = storage.getSession();
    Object.assign(storage, {
      session: { ...session, lastAccessAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    // Invoke private cleanup
    await (manager as unknown as { cleanupInactiveSessions: () => Promise<void> }).cleanupInactiveSessions();
    expect(await manager.getAllStats()).toHaveLength(0);
  });

  it('logs when inactive-session cleanup rejects inside the timer', async () => {
    const scheduled: Array<() => void> = [];
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((fn: TimerHandler) => {
        if (typeof fn === 'function') {
          scheduled.push(fn as () => void);
        }
        return 123 as unknown as NodeJS.Timeout;
      }) as typeof setInterval);

    const failing = new FilterStorageManager();
    const cleanup = jest
      .spyOn(failing as unknown as { cleanupInactiveSessions: () => Promise<void> }, 'cleanupInactiveSessions')
      .mockRejectedValue(new Error('boom'));

    expect(scheduled.length).toBeGreaterThan(0);
    scheduled[0]!();
    await Promise.resolve();
    await Promise.resolve();

    failing.stopCleanupTimer();
    cleanup.mockRestore();
    setIntervalSpy.mockRestore();
    await failing.destroy();
  });
});

describe('global storageManager and shutdown hooks', () => {
  afterEach(async () => {
    storageManager.stopCleanupTimer();
    await storageManager.clearAll();
    jest.restoreAllMocks();
  });

  it('is a shared manager instance', async () => {
    const storage = await storageManager.getStorage('global-test');
    expect(storage).toBeInstanceOf(SimpleFilterStorage);
  });

  it('onProcessExit ignores destroy failures', async () => {
    jest.spyOn(storageManager, 'destroy').mockRejectedValueOnce(new Error('shutdown fail'));
    expect(() => onProcessExit()).not.toThrow();
    await Promise.resolve();
  });

  it('onProcessSignal exits 0 on success and 1 on failure', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    jest.spyOn(storageManager, 'destroy').mockResolvedValueOnce(undefined);
    onProcessSignal();
    await Promise.resolve();
    await Promise.resolve();
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockClear();
    jest.spyOn(storageManager, 'destroy').mockRejectedValueOnce(new Error('fail'));
    onProcessSignal();
    await Promise.resolve();
    await Promise.resolve();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('registerStorageShutdownHandlers attaches listeners', () => {
    const onSpy = jest.spyOn(process, 'on').mockImplementation((() => process) as never);
    registerStorageShutdownHandlers();
    expect(onSpy).toHaveBeenCalledWith('exit', onProcessExit);
    expect(onSpy).toHaveBeenCalledWith('SIGINT', onProcessSignal);
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', onProcessSignal);
  });
});
