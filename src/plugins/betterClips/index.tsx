/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { getIntlMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Activity } from "@vencord/discord-types";
import { PresenceStore, UserStore } from "@webpack/common";


const settings = definePluginSettings({
    clipAllStreams: {
        description: "Allows clipping on all streams regardless of the streamer's settings.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    clipAllParticipants: {
        description: "Allows recording of all voice call participants regardless of their settings.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    moreClipSettings: {
        description: "Adds more FPS and duration options in settings.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    ignorePlatformRestriction: {
        type: OptionType.BOOLEAN,
        description: "Allow Platform Restricted Clipping (may cause save errors)",
        default: true,
        restartNeeded: true
    },
    richPresenceTagging: {
        type: OptionType.SELECT,
        description: "When should clips be tagged with the current Rich Presence?",
        options: [
            { label: "Always", value: "always" },
            { label: "Only when beginning or end of activity name matches", value: "whenMatched", default: true },
            { label: "Never", value: "never" },
        ]
    },
    enableScreenshotKeybind: {
        type: OptionType.BOOLEAN,
        description: "Enable the screenshot keybind feature",
        default: true,
        restartNeeded: true
    }
});

export default definePlugin({
    name: "BetterClips",
    authors: [
        Devs.Loukious,
        Devs.niko,
        Devs.Joona,
        Devs.keyages
    ],
    description: "Enables extra clipping options for streams.",
    settings,
    patches: [
        {
            predicate: () => settings.store.clipAllStreams,
            find: "}isViewerClippingAllowedForUser",
            replacement: {
                match: /isViewerClippingAllowedForUser\(\w+\){/,
                replace: "$&return true;"
            }
        },
        {
            predicate: () => settings.store.clipAllParticipants,
            find: "}isVoiceRecordingAllowedForUser",
            replacement: {
                match: /isVoiceRecordingAllowedForUser\(\w+\){/,
                replace: "$&return true;"
            }
        },
        // The framerate/timeslot option arrays used to live inline in the clips
        // settings module; the client now keeps them in a separate module whose
        // functions are referenced from the settings via useOptions
        {
            find: 'id:"30s"',
            replacement: [
                {
                    match: /\[\{id:"30s",value:\i\.\i\.SECONDS_30.{0,500}?\},?\]/,
                    // The arrays are returned directly (return[...]), so the replacement
                    // must start with a space or it would fuse with the "return" keyword
                    replace: " $self.patchTimeslots($&)"
                },
                {
                    match: /\[\{id:"15",value:\i\.\i\.FPS_15.{0,500}?\},?\]/,
                    replace: " $self.patchFramerates($&)"
                }
            ]
        },
        // enables clips
        // The experiment was slimmed down: only enableClips and
        // ignorePlatformRestriction remain as config (enableVoiceOnlyClips and
        // enableAdvancedSignals were removed from the client entirely), and the
        // screenshot keybind is no longer a config flag — it's hardcoded off in
        // two functions (the keybind settings UI row and the actual keybind
        // handler gate)
        {
            find: "2026-03-clips-experiment",
            replacement: [
                {
                    // Enable clips for everyone and honor the platform
                    // restriction setting, in the defaults and in both
                    // experiment variations (enrolled users get these merged
                    // over the defaults)
                    match: /defaultConfig:\{enableClips:!\d,ignorePlatformRestriction:!\d\},variations:\{1:\{enableClips:!0,ignorePlatformRestriction:!\d\},2:\{enableClips:!0,ignorePlatformRestriction:!\d\},?\}/,
                    replace: "defaultConfig:{enableClips:!0,ignorePlatformRestriction:$self.settings.store.ignorePlatformRestriction},variations:{1:{enableClips:!0,ignorePlatformRestriction:$self.settings.store.ignorePlatformRestriction},2:{enableClips:!0,ignorePlatformRestriction:$self.settings.store.ignorePlatformRestriction}}"
                },
                {
                    // Screenshot keybind flag used by the keybind settings UI
                    match: /(?<=function h\(\)\{)return!\d/,
                    replace: "$self.settings.store.enableScreenshotKeybind"
                },
                {
                    // Screenshot keybind gate in the actual keybind handler
                    match: /(?<=function A\(\)\{)return!\d/,
                    replace: "$self.settings.store.enableScreenshotKeybind"
                }
            ]
        },
        {
            find: "#{intl::CLIPS_UNKNOWN_SOURCE}",
            replacement: {
                match: /(applicationName:)(.{0,50})(,applicationId:)(\i)/,
                replace: "$1$2$3$self.getApplicationId($2)??$4"
            }
        }
    ],
    patchTimeslots(timeslots: { id: string; value: number; label: string; }[]) {
        const newTimeslots = [...timeslots];
        const extraTimeslots = [3, 4, 5, 6, 7, 10, 15, 20, 25, 30];

        extraTimeslots.forEach(timeslot => newTimeslots.push({
            id: `${timeslot}min`,
            value: timeslot * 60000,
            label: getIntlMessage("CLIPS_LENGTH_MINUTES", {
                count: timeslot
            })
        }));

        return newTimeslots.sort((a, b) => a.value - b.value);
    },

    patchFramerates(framerates: { id: string; value: number; label: string; }[]) {
        const newFramerates = [...framerates];
        const extraFramerates = [45, 90, 120, 144, 165, 240];

        // Lower framerates than 15FPS have adverse affects on compression, 3 minute clips at 10FPS skyrocket the filesize to 200mb!!
        extraFramerates.forEach(framerate => newFramerates.push({
            id: `${framerate}fps`,
            value: framerate,
            label: getIntlMessage("SCREENSHARE_FPS_ABBREVIATED", {
                fps: framerate
            })
        }));

        return newFramerates.sort((a, b) => a.value - b.value);
    },
    getApplicationId(activityName: string) {
        if (settings.store.richPresenceTagging === "never") return null;

        const activities: Activity[] = PresenceStore.getActivities(UserStore.getCurrentUser().id);
        const validActivities = activities.filter(activity => activity.type === 0 && activity.application_id !== null);
        const splitName = activityName.split(" ");

        // Try to match activity by it's start and end
        const matchedActivities = validActivities.filter(activity => activity.name.endsWith(splitName.at(-1)!) || activity.name.startsWith(splitName.at(0)!));

        if (matchedActivities.length > 0) {
            return matchedActivities[0].application_id;
        }

        if (settings.store.richPresenceTagging !== "whenMatched") {
            return validActivities[0]?.application_id ?? null;
        }

        return null;
    },
});
