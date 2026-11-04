import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppClient } from '../app/providers';
import { settingsDocQueryOptions } from '../data/queries/tavern';
import { useSessionBridge } from '../runtime/session-bridge';
import './DesktopPreferences.css';

// Project the accepted ST document; Query remains the owner of that document.
export function DesktopPreferences() {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const query = useQuery(settingsDocQueryOptions(client));
  const raw = query.data?.settings;
  const settings = useMemo(() => raw ? JSON.parse(raw) : {}, [raw]);
  const power = settings.power_user ?? {};
  const chatBackground = useSyncExternalStore(
    bridge.subscribe,
    () => String(bridge.getContext().chatMetadata?.custom_background || ''),
    () => '',
  );
  const image = String(chatBackground || settings.background?.url || '')
    .replace(/url\((['"]?)(\/?backgrounds\/)/g, 'url($1/backgrounds/');
  const visible = Boolean(image && !image.includes('__transparent.png'));
  const fitting = settings.background?.fitting || 'classic';
  const backgroundSize = ({ classic: 'cover', cover: 'cover', contain: 'contain', stretch: '100% 100%', center: 'auto' } as Record<string, string>)[fitting] || 'cover';

  useLayoutEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    html.style.setProperty('--fontScale', String(power.font_scale ?? 1));
    if (power.chat_width !== undefined && power.chat_width !== 50) {
      body.style.setProperty('--vc-read', `${720 * power.chat_width / 50}px`);
    } else body.style.removeProperty('--vc-read');
    for (const key of ['--vc-blur-1', '--vc-blur-2', '--vc-blur-3']) {
      if (power.blur_strength !== undefined && power.blur_strength !== 10) {
        body.style.setProperty(key, `${power.blur_strength}px`);
      } else body.style.removeProperty(key);
    }
    body.dataset.vcBackground = String(visible);
    body.dataset.vcHideChatAvatars = String(power.hideChatAvatars_enabled === true);
    body.dataset.vcAvatarStyle = String(power.avatar_style ?? 0);
    body.dataset.vcCompactInput = String(power.compact_input_area !== false);
    const reduced = String(power.reduced_motion === true);
    if (html.dataset.vcNativeReducedMotion !== reduced) {
      html.dataset.vcNativeReducedMotion = reduced;
      window.dispatchEvent(new Event('vc-motion-preference'));
    }
  }, [power, visible]);

  useLayoutEffect(() => () => {
    document.documentElement.style.removeProperty('--fontScale');
    delete document.documentElement.dataset.vcNativeReducedMotion;
    for (const key of ['--vc-read', '--vc-blur-1', '--vc-blur-2', '--vc-blur-3']) {
      document.body.style.removeProperty(key);
    }
    for (const key of ['vcBackground', 'vcHideChatAvatars', 'vcAvatarStyle', 'vcCompactInput']) {
      delete document.body.dataset[key];
    }
    window.dispatchEvent(new Event('vc-motion-preference'));
  }, []);

  return <>
    <style data-vc-custom-css="">{power.custom_css || ''}</style>
    <div className="vc-tavern-background" hidden={!visible} aria-hidden="true" style={{ backgroundImage: image, backgroundSize }} />
  </>;
}
