import { Usage, type UsageProps } from '../models/Usage';

export type { UsageProps };
export type UsagePanelProps = UsageProps;

export function UsagePanel(props: UsagePanelProps) {
  return <Usage {...props} />;
}
