import { auth } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage() {
  const session = await auth();
  return <LoginForm signedInAs={session?.user?.email ?? null} />;
}
