const steps = ["花を選ぶ", "想いを添える", "カート", "お届け先", "お支払い"] as const;

export function CheckoutProgress({ currentStep }: { currentStep: number }) {
  return (
    <nav className="checkout-progress" aria-label="購入手続きの進捗">
      {steps.map((label, index) => {
        const step = index + 1;
        const state = step < currentStep ? "is-complete" : step === currentStep ? "is-current" : "";
        return (
          <span className={state || undefined} aria-current={step === currentStep ? "step" : undefined} key={label}>
            <b>{step}</b> {label}
          </span>
        );
      })}
    </nav>
  );
}
