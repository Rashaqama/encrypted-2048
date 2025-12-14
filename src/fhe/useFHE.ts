import { useEffect, useState } from "react";

declare global {
  interface Window {
    CoFHE: any;
  }
}

export const useFHE = () => {
  const [client, setClient] = useState<any>(null);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initCoFHE = async () => {
      try {
        // First try to load from CDN
        if (window.CoFHE) {
          const cofhe = new window.CoFHE({
            network: "base-sepolia",
          });

          await cofhe.init();
          setClient(cofhe);
          setInitialized(true);
          setError(null);
          console.log("CoFHE loaded from CDN - real FHE active");
          return;
        }
      } catch (err) {
        console.warn("CDN load failed - falling back to mock");
      }

      // Fallback to mock if CDN fails (for local testing)
      setClient({
        mock: true,
        encrypt32: (v: number) => v,
        unseal: (v: any) => v,
      });
      setInitialized(true);
      setError(null);
      console.log("Using mock FHE for local testing");
    };

    // Give CDN time to load
    const timer = setTimeout(initCoFHE, 1000);

    return () => clearTimeout(timer);
  }, []);

  return {
    client,
    initialized,
    error,
  };
};