/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { BaseText } from "@components/BaseText";
import { Flex } from "@components/Flex";
import { ContributorAuthorSummary } from "@plugins/philsPluginLibrary/components/ContributorAuthorSummary";
import { Author, Contributor } from "@plugins/philsPluginLibrary/types";
import { ModalProps } from "@vencord/discord-types";
import { Modal } from "@webpack/common";
import React, { JSX } from "react";


export interface SettingsModalProps extends Omit<ModalProps, "title" | "actions" | "actionBarInput"> {
    title?: string;
    onClose: () => void;
    onDone?: () => void;
    footerContent?: JSX.Element;
    closeButtonName?: string;
    author?: Author,
    contributors?: Contributor[];
}

function normalizeModalSize(size: SettingsModalProps["size"]) {
    switch (size) {
        case "small":
            return "sm";
        case "medium":
        case "dynamic":
            return "md";
        case "large":
            return "lg";
        default:
            return size;
    }
}

export const SettingsModal = (props: SettingsModalProps) => {
    const {
        author,
        children,
        closeButtonName,
        contributors,
        footerContent,
        onClose,
        onDone,
        size,
        title,
        ...modalProps
    } = props;

    return (
        <Modal
            {...modalProps}
            onClose={onClose}
            size={normalizeModalSize(size)}
            title={title && <BaseText size="lg" weight="semibold">{title}</BaseText>}
            actionBarInput={
                <Flex style={{ width: "100%", justifyContent: "flex-start", alignItems: "center", gap: "1em" }}>
                    {(author || contributors && contributors.length > 0) && (
                        <ContributorAuthorSummary author={author} contributors={contributors} />
                    )}
                    {footerContent}
                </Flex>
            }
            actions={[{
                text: closeButtonName ?? "Done",
                variant: "primary",
                onClick: onDone ?? onClose
            }]}
        >
            <div style={{ marginBottom: "1em", display: "flex", flexDirection: "column", gap: "1em" }}>
                {children}
            </div>
        </Modal>
    );
};
