import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDocenteTucAuth } from "@/lib/auth";
import { accountFromValidatedSession } from "@/lib/auth-identity";
import { communityDatabase } from "@/lib/community-route";
import { isCommunityAdmin } from "@/lib/community-admin";
import { CommunityAdminPanel } from "@/components/community-admin-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const auth = await getDocenteTucAuth();
  const session = auth ? await auth.api.getSession({ headers: await headers() }) : null;
  const account = accountFromValidatedSession(session);
  if (!account) notFound();
  try {
    if (!await isCommunityAdmin(await communityDatabase(), account.accountId)) notFound();
  } catch { notFound(); }
  return <CommunityAdminPanel />;
}
