export type QuantityStepperProps = Readonly<{
  label: string;
  value: number;
  minimum?: number;
  maximum: number;
  isDisabled?: boolean;
  onChange: (value: number) => void;
}>;
