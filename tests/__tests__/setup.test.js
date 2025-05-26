describe('Test Setup', () => {
  test('Jest should be properly configured', () => {
    expect(true).toBe(true);
  });

  test('ES modules should work', async () => {
    const module = await import('../../utils/api-keys.js');
    expect(module.getNotionApiKeyForUserToken).toBeDefined();
    expect(module.getFirefliesApiTokenForUserToken).toBeDefined();
  });
});