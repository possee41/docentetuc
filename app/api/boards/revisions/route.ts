import { getD1 } from "@/db/d1";
import { boardRevisions } from "@/lib/juntas-public-api";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => boardRevisions(request, getD1);
