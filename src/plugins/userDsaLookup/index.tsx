/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { LinkButton } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { clearUserCache, DsaCaptchaError, fetchUserActions, getTotal, humanizeEnum } from "@plugins/userDsaLookup/api";
import { openDsaModal } from "@plugins/userDsaLookup/DsaModal";
import { Devs } from "@utils/constants";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import definePlugin, { PluginNative } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Clickable, useState } from "@webpack/common";

// Desktop native (captcha popup + cookie-aware API proxy); undefined on web
const Native = VencordNative.pluginHelpers["DSA Lookup"] as PluginNative<typeof import("@plugins/userDsaLookup/native")> | undefined;

// Same class groups as ReviewDB so this card is a pixel-perfect sibling of the
// User Reviews card below it
const ProfileCardClasses = findCssClassesLazy("cardsList", "firstCardContainer", "card", "container");
const ProfileCardContainerClasses = findCssClassesLazy("innerContainer", "icons", "icon", "displayCount", "displayCountText", "displayCountTextColor", "breadcrumb");
const ProfileCardOverlayClasses = findCssClassesLazy("overlay", "isPrivate", "outer");
const DMSideBarClasses = findCssClassesLazy("widgetPreviews");

export default definePlugin({
    name: "DSA Lookup",
    description: "Shows Discord's EU DSA transparency enforcement actions for a user on their profile",
    tags: ["Privacy", "Utility"],
    authors: [Devs.Loukious],

    settingsAboutComponent: () => (
        <LinkButton href="https://dsa.discord.food/home">
            Data from Discord's EU Digital Services Act transparency reports — dsa.discord.food
        </LinkButton>
    ),

    // Both patches append after the same widgets element ReviewDB anchors on.
    // Plugins patch in load order (= plugin folder name order, this folder is
    // named to sort after "reviewDB"), so this section renders directly ABOVE
    // ReviewDB's User Reviews card. Do NOT rename this folder to something
    // that sorts before "reviewDB", and do not change the replacements to
    // prepend-style: the anchor starts inside the widgets element's props
    // object, so anything inserted before the match lands mid-object and
    // breaks the module.
    //
    // The sidebar match deliberately does NOT copy ReviewDB's
    // `.{0,100}unownedWishlistItems` lookahead: ReviewDB patches first and its
    // $self replacement expands to ~86 chars, pushing unownedWishlistItems
    // past the 100-char window and making the copy fail with "had no effect".
    // Anchoring structurally on `widgets:\i.widgets` + the widget's own `})})`
    // close instead is immune to whatever ReviewDB inserts after the anchor.
    patches: [
        {
            // DM profile sidebar — same anchor as ReviewDB
            find: ".SIDEBAR,disableToolbar:",
            replacement: {
                match: /user:(\i),widgets:\i\.widgets,.{0,100}?\}\)\}\),/,
                replace: "$&$self.renderProfileComponent({user:$1,isSideBar:true}),"
            }
        },
        {
            // User popout — same find as ReviewDB / ShowConnections
            find: '"UserProfilePopout");',
            replacement: {
                match: /user:(\i),widgets:.{0,100}?\}\),/,
                replace: "$&$self.renderProfileComponent({user:$1}),"
            }
        }
    ],

    renderProfileComponent: ErrorBoundary.wrap(({ user, isSideBar = false }: { user: User; isSideBar?: boolean; }) => {
        // bumped when the captcha popup closes, so useAwaiter refetches with
        // the session cookie the popup just earned
        const [captchaRound, setCaptchaRound] = useState(0);
        // true while the verification window is up, so the card can show a
        // loading state instead of looking like a dead button that invites
        // spam-clicking
        const [verifying, setVerifying] = useState(false);
        // same shape as ReviewDB: always render the card, even while the
        // request is in flight — never return null or the section appears to
        // "randomly" vanish on clean profiles
        const [data, error] = useAwaiter(() => fetchUserActions(user.id), { deps: [user.id, captchaRound], fallbackValue: null });

        let subtitle: string;
        let onClick: (() => void) | undefined;

        if (error instanceof DsaCaptchaError) {
            subtitle = verifying
                ? "Verifying with dsa.discord.food…"
                : "Captcha required — click to auto-verify";
            onClick = verifying ? undefined : async () => {
                if (Native) {
                    // the popup runs on Discord's session, so the cookie it
                    // earns is picked up by the refetch
                    setVerifying(true);
                    try {
                        await Native.openCaptchaPopup();
                    } finally {
                        setVerifying(false);
                    }
                    clearUserCache(user.id);
                    setCaptchaRound(r => r + 1);
                } else {
                    VencordNative.native.openExternal("https://dsa.discord.food/download");
                }
            };
        } else if (error) {
            console.warn("[DSA Lookup] Failed to fetch enforcement actions:", error);
            subtitle = `Error: ${String(error.message ?? error).slice(0, 80)}`;
            // click retries the fetch (e.g. transient network error)
            onClick = () => {
                clearUserCache(user.id);
                setCaptchaRound(r => r + 1);
            };
        } else if (data) {
            const actions = data.actions ?? [];
            const total = getTotal(data);
            subtitle = actions.length === 0
                ? "No actions recorded"
                : `${total} action${total === 1 ? "" : "s"} · latest: ${humanizeEnum(actions[0].category)}`;
            onClick = () => openDsaModal(user, data);
        } else {
            subtitle = "Checking DSA records…";
        }

        const section = (
            <section className={ProfileCardClasses.container}>
                <ul className={ProfileCardClasses.cardsList} tabIndex={-1}>
                    <li className={ProfileCardClasses.firstCardContainer}>
                        <Clickable
                            className={ProfileCardContainerClasses.breadcrumb}
                            onClick={onClick}
                        >
                            <div className={classes(ProfileCardOverlayClasses.overlay, ProfileCardContainerClasses.innerContainer, ProfileCardClasses.card)}>
                                <Paragraph size={isSideBar ? "sm" : "xs"} weight="medium">Transparency Report</Paragraph>
                                <Paragraph size={isSideBar ? "sm" : "xs"}>{subtitle}</Paragraph>
                            </div>
                        </Clickable>
                    </li>
                </ul>
            </section>
        );

        return isSideBar
            ? <div className={DMSideBarClasses.widgetPreviews}>{section}</div>
            : section;
    }, { noop: true })
});
