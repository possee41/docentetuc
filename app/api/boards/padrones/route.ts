import { getD1 } from "@/db/d1";
import { padronesPage } from "@/lib/juntas-public-api";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => padronesPage(request, getD1);
