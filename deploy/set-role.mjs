// Grant / revoke access:  PROJECT_ID=my-project node deploy/set-role.mjs <email> <admin|member|none>
// Uses Application Default Credentials (`gcloud auth application-default login`, or Cloud Shell).
// The user then presses "Kiểm tra lại" (or signs in again) to receive the new role.
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [email, role] = process.argv.slice(2);
const projectId = process.env.PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!email || !['admin', 'member', 'none'].includes(role ?? '') || !projectId) {
  console.error('usage: PROJECT_ID=my-project node deploy/set-role.mjs <email> <admin|member|none>');
  process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
const { role: _previous, ...rest } = user.customClaims ?? {};
await auth.setCustomUserClaims(user.uid, role === 'none' ? rest : { ...rest, role });
await auth.revokeRefreshTokens(user.uid); // the next token carries the new claims
console.log(`${email} (${user.uid}) → ${role}`);
