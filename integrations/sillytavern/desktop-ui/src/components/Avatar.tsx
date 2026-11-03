import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';

export function Avatar({ src, fallback }: { src?: string; fallback: string }) {
    return <AvatarPrimitive.Root className="vc-side-avatar" aria-hidden="true">
        {src && <AvatarPrimitive.Image src={src} alt="" />}
        <AvatarPrimitive.Fallback>{fallback}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>;
}
