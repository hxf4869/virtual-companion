import { useCallback, useEffect, useRef, useState } from 'react';
import {
    INPUT_COPY,
    recordingWAV,
} from '../../../../extension/vc-model-settings/voice-logic.js';
import { useAppClient } from '../../app/providers';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';
import { Icon } from '../../design/components/Icon';

export interface VoiceRecorderProps {
    onAvailableChange?: (available: boolean) => void;
}

type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'listening' | 'cancelled';

export function VoiceRecorder({ onAvailableChange }: VoiceRecorderProps) {
    const client = useAppClient();
    const bridge = useSessionBridge();
    const activeKey = useChatSnapshot(s => s.key);
    const mode = useChatSnapshot(s => s.mode);
    const draft = useChatSnapshot(() => bridge.draft.read());
    const busy = useChatSnapshot(s => s.busy);

    const [asrAvailable, setAsrAvailable] = useState(false);
    const [maxSeconds, setMaxSeconds] = useState(60);
    const [phase, setPhase] = useState<RecorderPhase>('idle');
    const [noteText, setNoteText] = useState('');
    const [noteVisible, setNoteVisible] = useState(false);

    const phaseRef = useRef<RecorderPhase>('idle');
    const cancelledRef = useRef(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const frameRef = useRef<number>(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const levelRef = useRef<HTMLSpanElement | null>(null);
    const aliveRef = useRef(true);
    const activeKeyRef = useRef(activeKey);
    activeKeyRef.current = activeKey;

    const supported =
        typeof globalThis !== 'undefined' &&
        typeof globalThis.MediaRecorder === 'function' &&
        Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);

    const releaseMedia = useCallback(() => {
        if (timerRef.current !== undefined) {
            clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
        if (frameRef.current) {
            window.cancelAnimationFrame(frameRef.current);
            frameRef.current = 0;
        }
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (audioContextRef.current) {
            void audioContextRef.current.close().catch(() => {});
            audioContextRef.current = null;
        }
    }, []);

    const reset = useCallback(() => {
        releaseMedia();
        recorderRef.current = null;
        phaseRef.current = 'idle';
        if (aliveRef.current) {
            setPhase('idle');
            setNoteVisible(false);
        }
    }, [releaseMedia]);

    const fail = useCallback(() => {
        if (!aliveRef.current) return;
        releaseMedia();
        recorderRef.current = null;
        phaseRef.current = 'idle';
        setPhase('idle');
        setNoteText(INPUT_COPY.failed);
        setNoteVisible(true);
    }, [releaseMedia]);

    const finish = useCallback(
        (cancel = false) => {
            cancelledRef.current = cancel;
            if (timerRef.current !== undefined) {
                clearTimeout(timerRef.current);
                timerRef.current = undefined;
            }
            if (phaseRef.current === 'requesting') {
                phaseRef.current = 'cancelled';
                setPhase('cancelled');
                return;
            }
            if (phaseRef.current !== 'recording') return;
            phaseRef.current = 'listening';
            setPhase('listening');
            setNoteText(INPUT_COPY.listening);
            recorderRef.current?.stop();
        },
        [],
    );

    const refreshCapabilities = useCallback(async () => {
        if (
            !supported ||
            typeof client?.go?.fetchVoiceEngines !== 'function' ||
            typeof client?.go?.fetchVoiceSettings !== 'function'
        ) {
            setAsrAvailable(false);
            return;
        }
        try {
            const [caps, settings] = await Promise.all([
                client.go.fetchVoiceEngines(),
                client.go.fetchVoiceSettings(),
            ]);
            if (!aliveRef.current) return;
            const enabledAndHealthy = Boolean((caps as any)?.asr?.enabled && (caps as any)?.asr?.healthy);
            setAsrAvailable(enabledAndHealthy);
            if (typeof (settings as any)?.maxRecordingSeconds === 'number') {
                setMaxSeconds((settings as any).maxRecordingSeconds);
            }
        } catch {
            if (aliveRef.current) {
                setAsrAvailable(false);
            }
        }
    }, [client, supported]);

    useEffect(() => {
        aliveRef.current = true;
        void refreshCapabilities();
        const onVoiceSettings = () => {
            void refreshCapabilities();
        };
        window.addEventListener('vc-voice-settings-changed', onVoiceSettings);
        return () => {
            aliveRef.current = false;
            cancelledRef.current = true;
            window.removeEventListener('vc-voice-settings-changed', onVoiceSettings);
            if (recorderRef.current?.state === 'recording') {
                recorderRef.current.stop();
            }
            releaseMedia();
        };
    }, [refreshCapabilities, releaseMedia]);

    useEffect(() => {
        // Cancel any active recording when switching conversation
        if (phaseRef.current !== 'idle') {
            finish(true);
        } else {
            setNoteVisible(false);
        }
        void refreshCapabilities();
    }, [activeKey, finish, refreshCapabilities]);

    const showButton =
        supported &&
        asrAvailable &&
        (mode === 'COMPANION' || !mode) &&
        !draft.trim() &&
        !busy;

    useEffect(() => {
        onAvailableChange?.(showButton);
    }, [showButton, onAvailableChange]);

    const startRecording = async () => {
        if (!aliveRef.current || phaseRef.current !== 'idle' || !asrAvailable || !supported) return;
        phaseRef.current = 'requesting';
        cancelledRef.current = false;
        setPhase('requesting');
        setNoteVisible(false);
        const startKey = activeKeyRef.current;

        const isStillActive = () =>
            aliveRef.current && !cancelledRef.current && activeKeyRef.current === startKey;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            if ((phaseRef.current as RecorderPhase) === 'cancelled' || !isStillActive()) {
                reset();
                return;
            }
            const chunks: BlobPart[] = [];
            const recorder = new MediaRecorder(stream);
            recorderRef.current = recorder;

            recorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) chunks.push(event.data);
            });
            recorder.addEventListener(
                'stop',
                async () => {
                    const raw = new Blob(chunks, { type: recorder.mimeType });
                    chunks.length = 0;
                    releaseMedia();
                    if (!isStillActive()) {
                        reset();
                        return;
                    }
                    try {
                        const { wav, durationMs } = await recordingWAV(raw, { maxSeconds });
                        if (!isStillActive()) {
                            reset();
                            return;
                        }
                        const result: any = await client.go.transcribeVoice(wav);
                        if (!isStillActive()) {
                            reset();
                            return;
                        }
                        const metadata: { durationMs: number; emotion?: string } = { durationMs };
                        if (['HAPPY', 'SAD', 'ANGRY'].includes(result?.emotion)) {
                            metadata.emotion = result.emotion;
                        }
                        reset();
                        await bridge.send(result.text, { voiceInput: metadata, draftInput: null });
                    } catch {
                        fail();
                    }
                },
                { once: true },
            );
            recorder.addEventListener(
                'error',
                () => {
                    cancelledRef.current = true;
                    fail();
                },
                { once: true },
            );

            recorder.start(250);
            phaseRef.current = 'recording';
            setPhase('recording');
            setNoteVisible(true);
            const startedAt = Date.now();

            const AudioCtx =
                globalThis.AudioContext || (globalThis as any).webkitAudioContext;
            if (AudioCtx) {
                const audioCtx = new AudioCtx();
                audioContextRef.current = audioCtx;
                const source = audioCtx.createMediaStreamSource(stream);
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                source.connect(analyser);
                const values = new Uint8Array(analyser.fftSize);
                const meter = () => {
                    if (phaseRef.current !== 'recording') return;
                    analyser.getByteTimeDomainData(values);
                    let peak = 0;
                    for (const v of values) {
                        peak = Math.max(peak, Math.abs(v - 128) / 128);
                    }
                    levelRef.current?.style.setProperty(
                        '--vc-voice-level',
                        String(Math.min(1, peak * 3)),
                    );
                    const secs = Math.floor((Date.now() - startedAt) / 1000);
                    setNoteText(
                        `${secs}″ · ${cancelledRef.current ? INPUT_COPY.cancel : INPUT_COPY.recording}`,
                    );
                    frameRef.current = window.requestAnimationFrame(meter);
                };
                meter();
            }
            timerRef.current = setTimeout(() => finish(false), maxSeconds * 1000);
        } catch {
            fail();
        }
    };

    if (!supported) return null;

    return (
        <>
            <button
                type="button"
                id="vc-voice-input"
                aria-label={phase === 'recording' ? INPUT_COPY.stop : INPUT_COPY.start}
                aria-pressed={phase === 'recording'}
                hidden={!showButton && phase === 'idle'}
                disabled={phase === 'listening'}
                onClick={() => {
                    if (phaseRef.current === 'recording') {
                        finish(false);
                    } else {
                        void startRecording();
                    }
                }}
                onKeyDown={e => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        finish(true);
                    }
                }}
            >
                <Icon name="mic" size={20} />
            </button>
            <div id="vc-voice-input-note" role="status" hidden={!noteVisible}>
                <span>{noteText}</span>
                <span ref={levelRef} className="vc-voice-input-level" aria-hidden="true" />
            </div>
        </>
    );
}
