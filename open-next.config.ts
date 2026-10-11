import { defineCloudflareConfig } from '@opennextjs/cloudflare';
// No ISR cache: private reader data is fetched directly from Supabase.
export default defineCloudflareConfig({});
