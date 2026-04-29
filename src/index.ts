import { create } from "node:domain";
import welcomeEmail from "./templates/welcome.html"
import { env } from "cloudflare:workers"

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

export default {
	// The scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(event, env, ctx): Promise<void> {
		const repos = await fetchRepositories();
		const adminPwd = await env.ADMIN_PWD.get();

		for (const repo of repos.repos) {
			if (!repo.active) { console.log(`Skipping inactive repo: ${repo.did}`); continue; }
			try {
				const accountInfo = await fetchAccountInfo(repo.did, adminPwd);
				if (await hasRepoBeenWelcomed(accountInfo.did)) {
					console.log(`Already welcomed ${accountInfo.handle} (${accountInfo.did}), skipping.`);
					continue;
				}
				// Send welcome email initially
				const emailContent = customiseWelcomeEmail(welcomeEmail, accountInfo);
				try {
					await sendWelcomeEmail(accountInfo.email, emailContent);
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
				// Notify Zoho Desk to create support contact
				try {
					await notifyZohoDesk(accountInfo);
					console.log(`Notified Zoho Desk about new account ${accountInfo.handle} (${accountInfo.did})`);
				} catch (err) {
					console.error(`Failed to notify Zoho Desk about ${accountInfo.handle} (${accountInfo.did})`);
				}
				// Create Hubspot Contact
				try {
					await createHubspotContact(accountInfo);
					console.log(`Created Hubspot Contact for ${accountInfo.did}.`)
				} catch (err) {
					console.error(`Failed to create Hubspot Contact for ${accountInfo.did}.`)
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

async function notifyZohoDesk(accountInfo: AccountInfo): Promise<void> {
	const apiKey = await env.ZOHO_FLOW_API_KEY.get();
	if (!apiKey) {
		throw new Error("Zoho Flow API key is not configured");
	}
	const flowUrl = "https://flow.zoho.eu/20111363487/flow/webhook/incoming?zapikey=" + apiKey + "&isdebug=false";
	const payload = {
		did: accountInfo.did,
		handle: accountInfo.handle,
		email: accountInfo.email,
	}
	const response = await fetch(flowUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Failed to notify Zoho Desk: ${response.status} ${response.statusText} - ${errorText}`);
	}
}

function hasRepoBeenWelcomed(did: string): Promise<boolean> {
	return env.WELCOME_KV.get(did).then((value) => value !== null);
}

function customiseWelcomeEmail(template: string, accountInfo: AccountInfo): string {
	return template
		.replace(/{{ACCOUNT_HANDLE}}/g, accountInfo.handle)
		.replace(/{{ACCOUNT_DID}}/g, accountInfo.did);
}

async function sendWelcomeEmail(to: string, content: string): Promise<void> {
	const emailJson = buildEmailPayload(to, content);
	const response = await env.EMAIL.send(emailJson);
	console.log(`Email sent: ${response.messageId}`);
}

function buildEmailPayload(to: string, content: string) {
	return {
		to: to,
		from: {
			email: env.ACS_SENDER,
			name: "Tophhie Social"
		},
		subject: "Welcome to Tophhie Social!",
		html: content,
	}
}

async function createHubspotContact(account: AccountInfo): Promise<boolean> {
	let apiKey = env.HUBSPOT_CONTACT_KEY.get();
	let url = "https://api.hubapi.com/crm/v3/objects/contacts";
	const response = await fetch(url, {
		method: "POST",
		headers: {
		"Content-Type": "application/json",
		"Authorization": `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			email: account.email,
			atprotocol_did: account.did,
			registered_services: "Tophhie Social"
		}),
	});
	return response.ok;
}