import { useEffect, useState } from "react";

export const useFHE = () => {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setTimeout(() => setInitialized(true), 500);
  }, []);

  return {
    initialized,
    client: null,
  };
};