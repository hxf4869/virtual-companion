import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import {
    useCharacters,
    type CharacterCardItem,
} from '../../data/queries/characters';
import { CharacterGrid } from './CharacterGrid';
import { CharacterDetail } from './CharacterDetail';
import { ImportCharacter } from './ImportCharacter';
import { CreateWizard } from './CreateWizard';
import './characters.css';

export interface CharactersRouteProps {
    avatar?: string;
}

export function CharactersRoute({ avatar }: CharactersRouteProps) {
    const navigate = useNavigate();
    const { cards, isLoading, isError, refetch } = useCharacters();

    const [searchQuery, setSearchQuery] = useState('');
    const [createWizardOpen, setCreateWizardOpen] = useState(false);

    const activeCard = useMemo<CharacterCardItem | null>(() => {
        const rawTarget = avatar ? String(avatar) : '';
        if (!rawTarget) return null;
        let decoded = rawTarget;
        try {
            decoded = decodeURIComponent(rawTarget);
        } catch {
            decoded = rawTarget;
        }
        return (
            cards.find(
                (c) =>
                    (c.avatar && (c.avatar === decoded || c.avatar === rawTarget)) ||
                    (c.characterRef &&
                        (c.characterRef === decoded || c.characterRef === rawTarget)),
            ) ?? null
        );
    }, [cards, avatar]);

    const filteredCards = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return cards;
        return cards.filter((card) => {
            if (card.name.toLowerCase().includes(q)) return true;
            if (card.description.toLowerCase().includes(q)) return true;
            if (card.worldName.toLowerCase().includes(q)) return true;
            return card.instances.some((inst) =>
                inst.label.toLowerCase().includes(q),
            );
        });
    }, [cards, searchQuery]);

    const handleSelectCard = (card: CharacterCardItem) => {
        const target = card.avatar || card.characterRef;
        if (!target) return;
        if (
            activeCard &&
            ((card.avatar && card.avatar === activeCard.avatar) ||
                (card.characterRef && card.characterRef === activeCard.characterRef))
        ) {
            return;
        }
        void navigate({
            to: '/characters/$avatar',
            params: { avatar: target },
        });
    };

    const handleCloseDetail = () => {
        void navigate({ to: '/characters' });
    };

    const handleDeletedCard = () => {
        void navigate({ to: '/characters' });
    };

    return (
        <section
            className={`vc-characters-route${activeCard ? ' has-detail' : ''}`}
            data-page="characters"
            aria-label="角色"
        >
            <div className="vc-characters-main">
                <header className="vc-characters-header">
                    <h1>角色</h1>
                    <div className="vc-characters-header-actions">
                        <ImportCharacter
                            onImported={(imported) => {
                                const target = imported.avatar || imported.characterRef;
                                if (target) {
                                    void navigate({
                                        to: '/characters/$avatar',
                                        params: { avatar: target },
                                    });
                                }
                            }}
                        />
                        <Button
                            type="button"
                            variant="filled"
                            onClick={() => setCreateWizardOpen(true)}
                        >
                            <Icon name="plus" size={16} />
                            <span>新建角色</span>
                        </Button>
                    </div>
                </header>

                {cards.length > 1 || searchQuery ? (
                    <div className="vc-characters-toolbar">
                        <label className="vc-characters-search">
                            <Icon name="search" size={16} />
                            <input
                                type="search"
                                value={searchQuery}
                                placeholder="搜索角色"
                                aria-label="搜索角色"
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </label>
                    </div>
                ) : null}

                {isLoading ? (
                    <div className="vc-characters-empty" role="status">
                        <p>加载中…</p>
                    </div>
                ) : isError ? (
                    <div className="vc-characters-error" role="alert">
                        <p>加载失败，请重试。</p>
                        <Button
                            type="button"
                            variant="gray"
                            onClick={() => void refetch()}
                        >
                            重试
                        </Button>
                    </div>
                ) : cards.length === 0 ? (
                    <div className="vc-characters-empty">
                        <p>还没有角色</p>
                        <div className="vc-characters-header-actions">
                            <Button
                                type="button"
                                variant="filled"
                                onClick={() => setCreateWizardOpen(true)}
                            >
                                新建角色
                            </Button>
                        </div>
                    </div>
                ) : filteredCards.length === 0 ? (
                    <div className="vc-characters-empty">
                        <p>没有匹配的角色</p>
                    </div>
                ) : (
                    <CharacterGrid
                        cards={filteredCards}
                        selectedRef={activeCard?.characterRef}
                        selectedAvatar={activeCard?.avatar}
                        onSelectCard={handleSelectCard}
                    />
                )}
            </div>

            {activeCard ? (
                <CharacterDetail
                    key={activeCard.characterRef || activeCard.avatar}
                    card={activeCard}
                    onClose={handleCloseDetail}
                    onDeleted={handleDeletedCard}
                />
            ) : null}

            <CreateWizard
                open={createWizardOpen}
                onOpenChange={setCreateWizardOpen}
            />
        </section>
    );
}
