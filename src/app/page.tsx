import Experience from "@/components/experio/Experience";

/**
 * The public landing page: the Experio scroll film. All heavy three.js code
 * is code-split behind a client-only dynamic import inside Experience, so
 * this route's weight never reaches /login or /dashboard/* bundles.
 */
export default function Home() {
  return (
    <main>
      <Experience />
    </main>
  );
}
