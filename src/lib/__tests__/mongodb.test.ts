import { MongoClient } from 'mongodb'

// Ensure environment is present
// Ensure environment is present for tests (value doesn't matter due to mocking)
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://example.invalid/db'

// Use dynamic import to avoid hoisting

jest.mock('mongodb', () => {
  const connect = jest.fn();
  const db = jest.fn();
  const MC = function(){ } as any;
  (MC as any).prototype.connect = connect; 
  (MC as any).prototype.db = db; 
  return { MongoClient: MC };
});

describe('mongodb connectToDatabase', () => {
  afterEach(() => {
    jest.resetModules()
    jest.restoreAllMocks()
  })

  it('throws when URI missing', async () => {
    const old = process.env.MONGODB_URI
    delete process.env.MONGODB_URI
    await expect(import('../mongodb')).rejects.toThrow()
    process.env.MONGODB_URI = old
  })

  it('connects and caches', async () => {
    jest.resetModules()
    const connectMock = jest.fn().mockResolvedValue(undefined)
    const dbMock = jest.fn().mockReturnValue({ name: 'testdb' })
    jest.doMock('mongodb', () => {
      return { MongoClient: class {
        connect = connectMock;
        db = dbMock;
      } }
    })
    const mod = await import('../mongodb')
    const db1 = await mod.connectToDatabase()
    const db2 = await mod.connectToDatabase()
    expect(db1).toEqual(db2)
    expect(connectMock).toHaveBeenCalledTimes(1)
  })

  it('propagates connection errors', async () => {
    jest.resetModules()
    const connectMock = jest.fn().mockRejectedValue(new Error('boom'))
    jest.doMock('mongodb', () => {
      return { MongoClient: class {
        connect = connectMock;
        db = jest.fn();
      } }
    })
    const mod = await import('../mongodb')
    await expect(mod.connectToDatabase()).rejects.toThrow('Could not connect to the database.')
  })
})
