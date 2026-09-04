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

import { cdnBaseUrl, questAssetsBaseUrl } from "@plugins/questCompleter/constants";
import { getQuestById } from "@plugins/questCompleter/quests";

export function buildQuestAssetUrl(questId: string, asset: string, theme?: "dark" | "light") {
    // Mirrors Discord's getQuestAssetUrl: asset names containing "/" are already
    // paths relative to the CDN root, while plain filenames live under
    // /quests/{questId}/{theme?}/{filename}
    if (asset.includes("/")) return `${cdnBaseUrl}${asset}`;
    return `${questAssetsBaseUrl}${questId}${theme ? `/${theme}` : ""}/${asset}`;
}

function resolveThemedAsset(questId: string, base: string | undefined, dark: string | undefined, light: string | undefined) {
    // Mirror Discord's game_tile/logo_type resolution: a themed variant is used as-is
    // (no theme segment in the URL), while the base asset is used with a theme segment
    const themed = dark ?? light;
    if (themed != null) return buildQuestAssetUrl(questId, themed);
    if (base != null) return buildQuestAssetUrl(questId, base, "dark");
    return null;
}

export function getQuestImageConfig(questId: string) {
    const quest = getQuestById(questId);
    const { logotype, logotypeDark, logotypeLight, gameTile, gameTileDark, gameTileLight, hero } = quest.config.assets;

    // Discord renders game tiles as squares (see its QuestPartnerBranding component),
    // while logotypes are wide wordmarks that would be squashed into the square
    // notification icon slot — so prefer the game tile, falling back to the logotype
    const icon = resolveThemedAsset(questId, gameTile, gameTileDark, gameTileLight)
        ?? resolveThemedAsset(questId, logotype, logotypeDark, logotypeLight);

    const image = hero != null ? buildQuestAssetUrl(questId, hero) : undefined;

    return { icon: icon ?? undefined, image };
}
