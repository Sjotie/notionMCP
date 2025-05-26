export function getNotionApiKeyForUserToken(userToken) {
  if (!userToken) return null;
  const envVarName = `${userToken.toUpperCase()}_NOTION_API_KEY`;
  const apiKey = process.env[envVarName];
  if (apiKey) {
    console.log(`[${userToken}] Found Notion API key in env var: ${envVarName}`);
    return apiKey;
  }
  console.warn(`[${userToken}] No specific Notion API key found in env for token. Falling back to default if available.`);
  return process.env.DEFAULT_NOTION_API_KEY;
}

export function getFirefliesApiTokenForUserToken(userToken) {
  if (!userToken) return null;
  const envVarName = `${userToken.toUpperCase()}_FIREFLIES_API_TOKEN`;
  const apiToken = process.env[envVarName];
  if (apiToken) {
    console.log(`[${userToken}] Found Fireflies API token in env var: ${envVarName}`);
    return apiToken;
  }
  console.warn(`[${userToken}] No Fireflies API token for token; using default if set.`);
  return process.env.DEFAULT_FIREFLIES_API_TOKEN || null;
}