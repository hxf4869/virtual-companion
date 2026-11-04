import { Bindings, type BindingRow, type BindingsProps } from '../models/Bindings';

export type { BindingRow, BindingsProps };
export type PurposeBindingsProps = BindingsProps;

export function PurposeBindings(props: PurposeBindingsProps) {
  return <Bindings {...props} />;
}
