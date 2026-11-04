import { ProviderPane, type ProviderPaneProps } from '../models/ProviderPane';
import { Providers, type ProvidersProps } from '../models/Providers';

export type { ProviderPaneProps, ProvidersProps };
export type ProviderFormProps = ProviderPaneProps;

export function ProviderForm(props: ProviderFormProps) {
  return <ProviderPane {...props} />;
}

export { Providers as ProviderList };
