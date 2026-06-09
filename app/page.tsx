import { auth } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

// Root URL = sign-in form. Returns 200 + HTML so Railway's healthcheck and
// share-link recipients both land somewhere they can interact with. If the
// visitor already has a session, the form shows a "Continue to Dashboard"
// shortcut on top of the inputs.
export default async function Home() {
  const session = await auth();
  return <LoginForm signedInAs={session?.user?.email ?? null} />;
}
