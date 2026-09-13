/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LinkButton } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Span } from "@components/Span";
import { DsaAction, DsaSearchResult, formatDate, getActionReason, getRestrictions, getTotal, humanizeEnum } from "@plugins/userDsaLookup/api";
import { classNameFactory } from "@utils/css";
import type * as t from "@vencord/discord-types";
import { User } from "@vencord/discord-types";
import { Modal, openModal } from "@webpack/common";

const cl = classNameFactory("vc-dsa-");

function Row({ label, children }: { label: string; children: React.ReactNode; }) {
    return (
        <div className={cl("row")}>
            <Span size="xs" weight="medium" className={cl("label")}>{label}</Span>
            <Span>{children}</Span>
        </div>
    );
}

function ActionEntry({ action }: { action: DsaAction; }) {
    const reason = getActionReason(action);
    const restrictions = getRestrictions(action);

    return (
        <div className={cl("action")}>
            <div className={cl("action-head")}>
                <Paragraph size="md" weight="semibold">{humanizeEnum(action.category)}</Paragraph>
                <Span size="xs" className={cl("muted")}>
                    Applied {formatDate(action.applicationDate)} · Content from {formatDate(action.contentDate)}
                </Span>
            </div>

            {reason && <Paragraph>{reason}</Paragraph>}

            <Row label="Decisions">
                {restrictions.length
                    ? restrictions
                        .map(({ label, endDate, active }) => endDate
                            ? `${label} (until ${formatDate(endDate)}${active ? ", active" : ""})`
                            : label)
                        .join(", ")
                    : "None recorded"}
            </Row>

            {!!action.categorySpecification?.length && (
                <Row label="Specifications">{action.categorySpecification.map(humanizeEnum).join(", ")}</Row>
            )}
            <Row label="Ground">{humanizeEnum(action.decisionGround)}</Row>
            {!!action.contentType?.length && (
                <Row label="Content">
                    {[...action.contentType.map(humanizeEnum), action.contentTypeOther]
                        .filter(Boolean)
                        .join(", ")}
                </Row>
            )}
            <Row label="Detection">
                {action.automatedDetection ? "Automated" : "Manual"} detection · {humanizeEnum(action.automatedDecision)}
            </Row>
            <Row label="Source">{humanizeEnum(action.sourceType)}</Row>
            {!!action.territorialScope?.length && (
                <Row label="Territorial scope">{action.territorialScope.length} countries</Row>
            )}
            <Row label="Platform">{action.platformName}</Row>
            {action.decisionGroundReferenceUrl && (
                <Row label="Legal basis">
                    <LinkButton href={action.decisionGroundReferenceUrl}>Reference</LinkButton>
                </Row>
            )}
        </div>
    );
}

function DsaModal({ modalProps, user, result }: { modalProps: t.RenderModalProps; user: User; result: DsaSearchResult; }) {
    const total = getTotal(result);

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={`${user.username}'s Transparency Report (${total})`}
        >
            <div className={cl("list")}>
                {result.actions.length
                    ? result.actions.map(action => (
                        <ActionEntry key={action.uuid} action={action} />
                    ))
                    : <Paragraph className={cl("muted")}>No enforcement actions recorded for this user.</Paragraph>}
            </div>

            {result.pagination.hasMore && (
                <Paragraph className={cl("muted")}>
                    More than {result.actions.length} actions recorded — view the rest on dsa.discord.food
                </Paragraph>
            )}
            <Span size="xs" className={cl("muted")}>
                Data from Discord's EU Digital Services Act transparency reports, via dsa.discord.food
            </Span>
        </Modal>
    );
}

export function openDsaModal(user: User, result: DsaSearchResult) {
    openModal(modalProps => (
        <DsaModal modalProps={modalProps} user={user} result={result} />
    ));
}
