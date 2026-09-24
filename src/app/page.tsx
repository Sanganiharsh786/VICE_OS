import ViceOS from "@/components/ViceOS";
import { ViceProvider } from "@/lib/store";

export default function Page() {
  return (
    <ViceProvider>
      <ViceOS />
    </ViceProvider>
  );
}
