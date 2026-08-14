import OriginStory from "@/components/OriginStory";
import FlavorShowcase from "@/components/FlavorShowcase";
import Benefits from "@/components/Benefits";
import SocialProof from "@/components/SocialProof";
import Footer from "@/components/Footer";
import LazyEngineProvider from "@/lib/engine/react/LazyEngineProvider";
import { AutoSectionInk, FlavorSectionInk, FixedSectionInk } from "@/lib/section-ink";

// Server Component. Every section below still renders server-side; only the
// engine wrapper is client-lazy (see lib/engine/react/LazyEngineProvider.tsx),
// which is what keeps three.js out of `/`'s first-load JS.
export default function Home() {
  return (
    <>
      <main id="main-content" tabIndex={-1}>
        <AutoSectionInk>
          <LazyEngineProvider>
            <OriginStory />
          </LazyEngineProvider>
        </AutoSectionInk>
        <FlavorSectionInk>
          <FlavorShowcase />
        </FlavorSectionInk>
        <FixedSectionInk color="#F9F9EE">
          <Benefits />
        </FixedSectionInk>
        <FixedSectionInk color="#1D423C">
          <SocialProof />
        </FixedSectionInk>
      </main>
      <FixedSectionInk color="#F9F9EE">
        <Footer />
      </FixedSectionInk>
    </>
  );
}
