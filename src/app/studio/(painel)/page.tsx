import { requireStudio } from "@/server/auth/studio";

// Temporary: the dashboard is ported next.
export default async function DashboardPage() {
  await requireStudio();
  return <main id="conteudo">painel</main>;
}
