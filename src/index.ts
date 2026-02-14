import welcomeEmail from "./templates/welcome.html"

export interface ListReposResponse {
	total: number;
	active: number;
	inactive: number;
	repos: RepoSummary[];
}

export interface RepoSummary {
	did: string;
	head: string;
	rev: string;
	active: boolean;
}

export interface AccountInfo {
	did: string;
	handle: string;
	email: string;
	indexedAt: string;
	emailConfirmedAt: string;
}

interface Env {
	WELCOME_KV: KVNamespace;
	ADMIN_PWD: SecretsStoreSecret;
	ACS_ACCESS_KEY: SecretsStoreSecret;
	ACS_ENDPOINT: string;
	ACS_SENDER: string;
}

export default {
	// The scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(event, env, ctx): Promise<void> {
		const repos = await fetchRepositories();
		const adminPwd = await env.ADMIN_PWD.get();

		for (const repo of repos.repos) {
			
			if (repo.did !== "did:plc:ggobmtqnjirtchpwgydxoecb") { // TODO: remove this filter after testing
				console.log(`Skipping repo ${repo.did} due to filter.`);
				continue;
			}

			if (!repo.active) { console.log(`Skipping inactive repo: ${repo.did}`); continue; }
			try {
				const accountInfo = await fetchAccountInfo(repo.did, adminPwd);
				if (await hasRepoBeenWelcomed(env, accountInfo.did)) {
					console.log(`Already welcomed ${accountInfo.handle} (${accountInfo.did}), skipping.`);
					continue;
				}
				const emailContent = customiseWelcomeEmail(welcomeEmail, accountInfo);
				try {
					await sendWelcomeEmail(env, accountInfo.email, emailContent);
					await env.WELCOME_KV.put(
						repo.did,
						JSON.stringify({
							status: "sent",
							at: new Date().toISOString()
						})
					);
					console.log(`Welcomed ${accountInfo.handle} (${accountInfo.did}) with email ${accountInfo.email}`);
				} catch (err) {
					console.error(`Failed to send welcome email to ${accountInfo.handle} (${accountInfo.did}) at ${accountInfo.email}`);
					await env.WELCOME_KV.put(
						repo.did,
						JSON.stringify({
						status: "failed",
						at: new Date().toISOString(),
						reason: err instanceof Error ? err.message : "unknown error"
						})
					);
					continue;
				}
			} catch (err) {
				console.error(`Failed to fetch account info for repo ${repo.did}, skipping.`);
				await env.WELCOME_KV.put(
					repo.did,
					JSON.stringify({
					status: "failed",
					at: new Date().toISOString(),
					reason: err instanceof Error ? err.message : "unknown error"
					})
				);
				continue;
			}
		}
	},
} satisfies ExportedHandler<Env>;

async function fetchRepositories(): Promise<ListReposResponse> {
	const repos = await fetch('https://api.tophhie.cloud/pds/repos');
	if (!repos.ok) throw new Error(`Failed to fetch repositories: ${repos.statusText}`);
	return await repos.json();
};

async function fetchAccountInfo(repo: string, adminPwd: string): Promise<AccountInfo> {
	const authHeader = `Basic ${btoa(`admin:${adminPwd}`)}`;
	const accountInfo = await fetch(`https://tophhie.social/xrpc/com.atproto.admin.getAccountInfo?did=${repo}`, {
		headers: {
			'Authorization': authHeader,
		},
	});
	if (!accountInfo.ok) throw new Error(`Failed to fetch account info for ${repo}: ${accountInfo.statusText}`);
	return await accountInfo.json();
}

function hasRepoBeenWelcomed(env: Env, did: string): Promise<boolean> {
	return env.WELCOME_KV.get(did).then((value) => value !== null);
}

function customiseWelcomeEmail(template: string, accountInfo: AccountInfo): string {
	return template
		.replace(/{{ACCOUNT_HANDLE}}/g, accountInfo.handle)
		.replace(/{{ACCOUNT_DID}}/g, accountInfo.did);
}

async function sendWelcomeEmail(env: Env, to: string, content: string): Promise<void> {
  const apiVersion = "2025-09-01";
  const endpoint = env.ACS_ENDPOINT.replace(/\/$/, ""); // avoid accidental double slashes
  const url = `${endpoint}/emails:send?api-version=${apiVersion}`;

  const emailPayload = buildEmailPayload(env, to, content);
  const emailBody = JSON.stringify(emailPayload);

  const urlObj = new URL(url);
  const host = urlObj.host;
  const pathAndQuery = urlObj.pathname + urlObj.search;

  const timestamp = new Date().toUTCString();

  const contentHash = await sha256Base64(emailBody);

  const stringToSign = `POST\n${pathAndQuery}\n${timestamp};${host};${contentHash}`;

  const signature = await hmacSha256Base64(await env.ACS_ACCESS_KEY.get(), stringToSign);

  const authHeader = `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Host": host,
      "x-ms-date": timestamp,
      "x-ms-content-sha256": contentHash,
      "Authorization": authHeader,
    },
    body: emailBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send email: ${response.status} ${response.statusText} - ${errorText}`);
  }
}

function buildEmailPayload(env: Env, to: string, content: string) {
	return {
		senderAddress: env.ACS_SENDER,
		recipients: {
			to: [{address: to}],
		},
		content: {
			subject: 'Welcome to Tophhie Social!',
			html: content,
		},
		replyTo: [
			{address: "help@tophhie.social"}
		]
	}
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

async function sha256Base64(message: string) {
  const data = new TextEncoder().encode(message)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return arrayBufferToBase64(hash)
}

async function hmacSha256Base64(keyBase64: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToArrayBuffer(keyBase64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message)
  )
  return arrayBufferToBase64(sig)
}