// Local PostgREST serves tables at its root. Supabase uses /rest/v1.
export function databaseRoot(env) {
  if (env.PLAYGO_ENV==='local') {
    const url=env.PLAYGO_LOCAL_REST_URL;
    if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(url??'') ||
        Number(url.split(':').pop())>65535) return null;
    return url;
  }
  const url=env.SUPABASE_URL;
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url??'')
    ? url.replace(/\/$/,'')+'/rest/v1' : null;
}

export function databaseKey(env) {
  return env.PLAYGO_ENV==='local' ? env.PLAYGO_LOCAL_WORKER_JWT : env.SUPABASE_SERVICE_ROLE_KEY;
}
