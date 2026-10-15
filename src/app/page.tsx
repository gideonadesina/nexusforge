import { Investigation } from "@/components/Investigation";

/**
 * The investigation view is the product. Everything it shows is fetched from
 * the API, which computes it from FalkorDB.
 */
export default function Home() {
  return <Investigation />;
}
