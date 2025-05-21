import IntentSignForm from "@/components/IntentSignForm";

export default function Home() {
  return (
    <main className="p-6">
      <IntentSignForm
        contractAddress="0xYourDeployedContractAddress"
        usdcAddress="0xUSDCAddress"
      />
    </main>
  );
}
