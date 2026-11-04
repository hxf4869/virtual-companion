import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import WaveSurfer from 'wavesurfer.js';
import {
    VOICE_COPY,
    formatVoiceRate,
    nextVoiceRate,
    readVoiceRate,
    voiceDeskWidth,
    voicePlayer as defaultVoicePlayer,
    voiceSeconds,
    voiceText,
    voiceWaveHeights,
    voiceWidth,
    writeVoiceRate,
} from '../../../../extension/vc-model-settings/voice-logic.js';
import { Icon } from '../../design/components/Icon';
import { useReducedMotion } from '../../shell/useReducedMotion';

export interface VoicePlayerLike {
    isCurrent?: (id: string | undefined) => boolean;
    peek?: (
        id: string | undefined,
    ) => { currentTime: number; duration: number; ended?: boolean; paused?: boolean } | null | undefined;
    subscribe?: (cb: () => void) => () => void;
    toggle: (
        id: string | undefined,
        callbacks?: { onState?: (playing: boolean) => void; onPlayed?: () => void; onError?: () => void },
    ) => Promise<unknown> | unknown;
    seek?: (id: string | undefined, time: number) => boolean;
    setRate?: (rate: number) => void;
}

export interface VoiceAttachment {
    clipId?: string;
    status?: string;
    durationMs?: number;
    played?: boolean;
    transcript?: string;
}

export interface VoiceBubbleProps {
    voice?: VoiceAttachment | null;
    input?: { durationMs?: number } | null;
    text?: string;
    player?: VoicePlayerLike;
    onPlayed?: () => void;
}

function isClipActivelyPlaying(
    player: VoicePlayerLike | undefined,
    clipId: string | undefined,
): boolean {
    if (!clipId || !player?.isCurrent?.(clipId)) return false;
    const info = player.peek?.(clipId);
    if (info && (info.ended || info.paused)) return false;
    return true;
}

function resolveWaveColors(): { waveColor: string; progressColor: string } {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
        return { waveColor: 'rgba(125, 116, 108, 0.45)', progressColor: '#c46b4c' };
    }
    const styles = getComputedStyle(document.documentElement);
    const ink3 = styles.getPropertyValue('--vc-ink-3').trim();
    const accent = styles.getPropertyValue('--vc-accent').trim();
    return {
        waveColor: ink3 || 'rgba(125, 116, 108, 0.45)',
        progressColor: accent || '#c46b4c',
    };
}

export function VoiceBubble({
    voice,
    input,
    text = '',
    player = defaultVoicePlayer,
    onPlayed,
}: VoiceBubbleProps) {
    const isInput = Boolean(input);
    const clipId = voice?.clipId;
    const isRecording = Boolean(
        !isInput && voice && (voice.status === 'queued' || voice.status === 'running'),
    );
    const durationMs = isInput ? input?.durationMs ?? 0 : voice?.durationMs ?? 0;
    const seconds = voiceSeconds(durationMs);
    const widthPct = voiceWidth(durationMs);
    const deskWidth = voiceDeskWidth(seconds);
    const heights = useMemo(() => voiceWaveHeights(clipId || text), [clipId, text]);
    const normalizedPeaks = useMemo(
        () => heights.map((h: number) => Math.max(0.08, Math.min(1, Number(h || 0) / 100))),
        [heights],
    );
    const cleanText = useMemo(
        () => voiceText(voice?.transcript ?? text),
        [voice?.transcript, text],
    );
    const reducedMotion = useReducedMotion();

    // B13: Read initial playing state from global/injected voicePlayer on mount
    const [playing, setPlaying] = useState<boolean>(() =>
        !isInput ? isClipActivelyPlaying(player, clipId) : false,
    );
    const [open, setOpen] = useState<boolean>(isInput);
    const [unread, setUnread] = useState<boolean>(() => !isInput && !voice?.played);
    const [rate, setRate] = useState<number>(() => readVoiceRate());

    const rootRef = useRef<HTMLDivElement | null>(null);
    const waveHostRef = useRef<HTMLSpanElement | null>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const aliveRef = useRef(true);
    const draggedRef = useRef(false);
    const resetDragTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const computeFraction = useCallback(() => {
        if (isInput || !clipId) return 0;
        const info = player?.peek?.(clipId);
        if (!info || info.ended) return 0;
        const total = info.duration || seconds;
        return total > 0 ? Math.min(1, Math.max(0, info.currentTime / total)) : 0;
    }, [isInput, clipId, player, seconds]);

    const syncWaveProgress = useCallback(() => {
        const ws = wsRef.current;
        if (!ws) return;
        const frac = computeFraction();
        const dur = ws.getDuration() || Math.max(1, seconds);
        ws.setTime(frac * dur);
    }, [computeFraction, seconds]);

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
            if (resetDragTimerRef.current !== undefined) {
                clearTimeout(resetDragTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (isRecording) return undefined;
        const host = waveHostRef.current;
        if (!host) return undefined;

        const { waveColor, progressColor } = resolveWaveColors();
        const ws = WaveSurfer.create({
            container: host,
            peaks: [normalizedPeaks],
            duration: Math.max(1, seconds),
            height: 20,
            barWidth: 3,
            barGap: 2,
            barRadius: 2,
            cursorWidth: 0,
            interact: false,
            dragToSeek: false,
            hideScrollbar: true,
            fillParent: true,
            normalize: false,
            waveColor,
            progressColor,
        });
        wsRef.current = ws;

        const onReady = () => {
            if (!aliveRef.current || wsRef.current !== ws) return;
            syncWaveProgress();
        };
        ws.on('ready', onReady);
        syncWaveProgress();

        return () => {
            ws.un('ready', onReady);
            if (wsRef.current === ws) {
                wsRef.current = null;
            }
            ws.destroy();
        };
    }, [isRecording, normalizedPeaks, seconds, syncWaveProgress]);

    useEffect(() => {
        if (isInput || !clipId) return undefined;
        const initialPlaying = isClipActivelyPlaying(player, clipId);
        setPlaying(initialPlaying);
        syncWaveProgress();
        return player?.subscribe?.(() => {
            if (!aliveRef.current) return;
            const current = isClipActivelyPlaying(player, clipId);
            setPlaying(current);
            syncWaveProgress();
        });
    }, [isInput, clipId, player, syncWaveProgress]);

    useEffect(() => {
        if (isInput) return undefined;
        player?.setRate?.(readVoiceRate());
        const onRateEvent = () => setRate(readVoiceRate());
        window.addEventListener('vc-voice-rate', onRateEvent);
        return () => window.removeEventListener('vc-voice-rate', onRateEvent);
    }, [isInput, player]);

    useEffect(() => {
        if (!playing || reducedMotion) {
            return undefined;
        }
        const timer = window.setInterval(() => {
            if (!aliveRef.current) return;
            syncWaveProgress();
        }, 80);
        return () => {
            window.clearInterval(timer);
        };
    }, [playing, reducedMotion, syncWaveProgress]);

    if (isRecording) {
        return (
            <div
                className="vc-voice is-recording"
                data-vc-voice-bubble=""
                data-playing="false"
                role="status"
            >
                <span className="vc-voice-dots" aria-hidden="true" />
                <span>{VOICE_COPY.recording}</span>
            </div>
        );
    }

    const seekTo = (time: number) => {
        if (player?.seek?.(clipId, time)) {
            syncWaveProgress();
        }
    };

    const seekPointer = (clientX: number, waveEl: HTMLElement) => {
        const rect = waveEl.getBoundingClientRect();
        const ratio = rect.width ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
        const total = player?.peek?.(clipId)?.duration || seconds;
        seekTo(ratio * total);
    };

    const handleCycleRate = () => {
        const next = nextVoiceRate(readVoiceRate());
        writeVoiceRate(next);
        player?.setRate?.(next);
        setRate(next);
        window.dispatchEvent(new CustomEvent('vc-voice-rate'));
    };

    const barContents = (
        <>
            <span className="vc-voice-glyph">
                <Icon name={isInput ? 'mic' : playing ? 'pause' : 'play'} size={16} />
            </span>
            <span
                ref={waveHostRef}
                className="vc-voice-wave"
                data-vc-wavesurfer=""
                aria-hidden="true"
                onPointerDown={e => {
                    if (isInput || !player?.isCurrent?.(clipId)) return;
                    draggedRef.current = true;
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    seekPointer(e.clientX, e.currentTarget);
                }}
                onPointerMove={e => {
                    if (draggedRef.current) {
                        seekPointer(e.clientX, e.currentTarget);
                    }
                }}
                onPointerUp={() => {
                    resetDragTimerRef.current = setTimeout(() => {
                        draggedRef.current = false;
                    }, 0);
                }}
                onPointerCancel={() => {
                    resetDragTimerRef.current = setTimeout(() => {
                        draggedRef.current = false;
                    }, 0);
                }}
            />
            <span className="vc-voice-duration">{`${seconds}″`}</span>
            {unread ? <span className="vc-voice-unread" role="img" aria-label={VOICE_COPY.unread} /> : null}
        </>
    );

    return (
        <div
            ref={rootRef}
            className={`vc-voice${playing ? ' is-playing' : ''}`}
            data-vc-voice-bubble=""
            data-playing={String(playing)}
            data-reduced-motion={String(reducedMotion)}
            style={{ '--voice-w': `${deskWidth}px` } as CSSProperties}
        >
            <Collapsible.Root open={open} onOpenChange={setOpen} style={{ display: 'contents' }}>
                {isInput ? (
                    <div
                        className="vc-voice-bar"
                        aria-label={VOICE_COPY.input}
                        style={{ '--voice-width': `${widthPct}%` } as CSSProperties}
                    >
                        {barContents}
                    </div>
                ) : (
                    <button
                        type="button"
                        className="vc-voice-bar"
                        style={{ '--voice-width': `${widthPct}%` } as CSSProperties}
                        aria-label={playing ? VOICE_COPY.pause : VOICE_COPY.play}
                        aria-pressed={playing}
                        onKeyDown={e => {
                            if (
                                (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') ||
                                !player?.isCurrent?.(clipId)
                            ) {
                                return;
                            }
                            const info = player?.peek?.(clipId);
                            if (!info) return;
                            e.preventDefault();
                            seekTo(info.currentTime + (e.key === 'ArrowRight' ? 1 : -1));
                        }}
                        onClick={() => {
                            if (draggedRef.current) return;
                            void player.toggle(clipId, {
                                onState(val) {
                                    if (!aliveRef.current) return;
                                    setPlaying(val);
                                    syncWaveProgress();
                                },
                                onPlayed() {
                                    onPlayed?.();
                                    if (aliveRef.current) setUnread(false);
                                },
                                onError() {
                                    if (aliveRef.current) setOpen(true);
                                },
                            });
                        }}
                    >
                        {barContents}
                    </button>
                )}

                {!isInput ? (
                    <button
                        type="button"
                        className="vc-voice-speed"
                        aria-label={VOICE_COPY.speed}
                        onClick={handleCycleRate}
                    >
                        {formatVoiceRate(rate)}
                    </button>
                ) : null}

                <Collapsible.Trigger className="vc-voice-transcribe">
                    {open ? VOICE_COPY.collapse : VOICE_COPY.transcript}
                </Collapsible.Trigger>
                <Collapsible.Panel keepMounted className="vc-voice-transcript">
                    <p className="vc-voice-text">{cleanText}</p>
                </Collapsible.Panel>
            </Collapsible.Root>
        </div>
    );
}
