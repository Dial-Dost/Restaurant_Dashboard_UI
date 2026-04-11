describe('mongodb connectToDatabase', () => {
  it('throws a migration message', async () => {
    const mod = await import('../mongodb')
    await expect(mod.connectToDatabase()).rejects.toThrow(
      'MongoDB connectivity has been removed.',
    )
  })
})
