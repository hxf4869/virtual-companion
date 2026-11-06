import type { ReactNode } from 'react';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { CharacterGrid } from './CharacterGrid';
import { CharacterDetail } from './CharacterDetail';
import { ImportCharacter } from './ImportCharacter';
import { CreateWizard } from './CreateWizard';
import { useCharactersState } from './useCharactersState';
import './characters.css';

export interface CharactersRouteProps {
    avatar?: string;
    onOpenCharacter: (avatar: string) => void | Promise<void>;
    onCloseCharacter: () => void | Promise<void>;
    onOpenConversation: (conversationKey: string) => void | Promise<void>;
    onEditCharacterCard: (avatar: string) => void | Promise<void>;
    onOpenVoiceSettings: (relationshipId: string) => void | Promise<void>;
    renderLeaveGuard: (dirty: boolean) => ReactNode;
}

export function CharactersRoute({
    avatar,
    onOpenCharacter,
    onCloseCharacter,
    onOpenConversation,
    onEditCharacterCard,
    onOpenVoiceSettings,
    renderLeaveGuard,
}: CharactersRouteProps) {
    const {
        cards,
        activeCard,
        filteredCards,
        searchQuery,
        setSearchQuery,
        createWizardOpen,
        setCreateWizardOpen,
        isLoading,
        isError,
        refetch,
        selectCard,
        openImportedCard,
        closeDetail,
        handleDeletedCard,
    } = useCharactersState({
        avatar,
        onOpenCharacter,
        onCloseCharacter,
    });

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
                        <ImportCharacter onImported={openImportedCard} />
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
                        onSelectCard={selectCard}
                    />
                )}
            </div>

            {activeCard ? (
                <CharacterDetail
                    key={activeCard.characterRef || activeCard.avatar}
                    card={activeCard}
                    onClose={closeDetail}
                    onDeleted={handleDeletedCard}
                    onOpenConversation={onOpenConversation}
                    onEditCharacterCard={onEditCharacterCard}
                    onOpenVoiceSettings={onOpenVoiceSettings}
                    renderLeaveGuard={renderLeaveGuard}
                />
            ) : null}

            <CreateWizard
                open={createWizardOpen}
                onOpenChange={setCreateWizardOpen}
                onOpenConversation={onOpenConversation}
            />
        </section>
    );
}
