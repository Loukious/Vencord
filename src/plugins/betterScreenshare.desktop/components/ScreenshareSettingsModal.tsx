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

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { MicrophoneSettingsModal } from "@plugins/betterMicrophone.desktop/components";
import { ScreenshareAudioProfile, ScreenshareAudioStore, ScreenshareProfile, ScreenshareStore } from "@plugins/betterScreenshare.desktop/stores";
import {
    MediaEngineStore,
    ProfilableStore,
    SettingsModal,
    SettingsModalCard,
    SettingsModalCardItem,
    SettingsModalCardRow,
    SettingsModalProfilesCard,
    types,
    validateNumberInput,
    validateTextInputNumber
} from "@plugins/philsPluginLibrary";
import { Styles } from "@plugins/philsPluginLibrary/styles";
import { ModalSize, openModalLazy } from "@utils/modal";
import { SelectOption } from "@vencord/discord-types";
import { React, Select, Slider, TextInput, useEffect, useState } from "@webpack/common";

const simpleResolutions: readonly (SelectOption & { value: types.Resolution; })[] = [
    {
        label: "480p",
        value: {
            height: 480,
            width: 720
        }
    },
    {
        label: "720p",
        value: {
            height: 720,
            width: 1280
        }
    },
    {
        label: "1080p",
        value: {
            height: 1080,
            width: 1920
        }
    },
    {
        label: "1440p",
        value: {
            height: 1440,
            width: 2560
        }
    },
    {
        label: "2160p",
        value: {
            height: 2160,
            width: 3840
        }
    }
] as const;

const simpleVideoBitrates: readonly SelectOption[] = [
    {
        label: "Low",
        value: 2500
    },
    {
        label: "Medium",
        value: 5000
    },
    {
        label: "Medium-High",
        value: 7500
    },
    {
        label: "High",
        value: 10000
    }
] as const;

interface CodecSelectOption extends SelectOption {
    value: string;
    encode: boolean;
}

export interface ScreenshareSettingsModalProps extends React.ComponentProps<typeof SettingsModal> {
    screenshareStore: ProfilableStore<ScreenshareStore, ScreenshareProfile>;
    screenshareAudioStore?: ProfilableStore<ScreenshareAudioStore, ScreenshareAudioProfile>;
    onAudioDone?: () => void;
}

export const ScreenshareSettingsModal = (props: ScreenshareSettingsModalProps) => {
    const { screenshareStore, screenshareAudioStore, onAudioDone } = props;

    const {
        currentProfile,
        profiles,
        simpleMode,
        setVideoBitrateEnabled,
        setVideoBitrateMax,
        setVideoBitrateMin,
        setVideoBitrateTarget,
        setVideoCodec,
        setVideoCodecEnabled,
        setFramerate,
        setFramerateEnabled,
        setHeight,
        setKeyframeInterval,
        setKeyframeIntervalEnabled,
        setResolutionEnabled,
        setVideoBitrate,
        setWidth,
        setCurrentProfile,
        getProfile,
        saveProfile,
        setHdrEnabled,
        setSimpleMode,
        deleteProfile,
        duplicateProfile,
        getCurrentProfile,
        getProfiles
    } = screenshareStore.use();


    const {
        name,
        framerate,
        framerateEnabled,
        height,
        keyframeInterval,
        keyframeIntervalEnabled,
        resolutionEnabled,
        videoBitrate,
        videoBitrateMax,
        videoBitrateMin,
        videoBitrateTarget,
        videoBitrateEnabled,
        videoCodec,
        videoCodecEnabled,
        width,
        hdrEnabled
    } = currentProfile;

    const [videoCodecs, setVideoCodecs] = useState<types.CodecCapabilities[]>([]);

    const codecOptions: CodecSelectOption[] = videoCodecs.map(codecCapabilities => ({
        label: codecCapabilities.codec,
        value: codecCapabilities.codec,
        key: codecCapabilities.codec,
        encode: codecCapabilities.encode
    }));

    const [isSaving, setIsSaving] = useState(false);

    const [isDetailedBitrate, setIsDetailedBitrate] = useState<boolean>(() => {
        const min = videoBitrateMin ?? videoBitrate;
        const target = videoBitrateTarget ?? videoBitrate;
        const max = videoBitrateMax ?? videoBitrate;
        return min !== target || target !== max || min !== max;
    });

    const [textinputWidth, setTextinputWidth] = useState<string>(width ? width.toString() : "");
    const [textinputHeight, setTextinputHeight] = useState<string>(height ? height.toString() : "");
    const [textinputFramerate, setTextinputFramerate] = useState<string>(framerate ? framerate.toString() : "");
    const [textinputKeyframeInterval, setTextinputKeyframeInterval] = useState<string>(keyframeInterval ? keyframeInterval.toString() : "");
    const [textinputVideoBitrateMin, setTextinputVideoBitrateMin] = useState<string>((videoBitrateMin ?? videoBitrate) ? (videoBitrateMin ?? videoBitrate)!.toString() : "");
    const [textinputVideoBitrateTarget, setTextinputVideoBitrateTarget] = useState<string>((videoBitrateTarget ?? videoBitrate) ? (videoBitrateTarget ?? videoBitrate)!.toString() : "");
    const [textinputVideoBitrateMax, setTextinputVideoBitrateMax] = useState<string>((videoBitrateMax ?? videoBitrate) ? (videoBitrateMax ?? videoBitrate)!.toString() : "");

    const [sliderKeyMin, setSliderKeyMin] = useState(0);
    const [sliderKeyTarget, setSliderKeyTarget] = useState(0);
    const [sliderKeyMax, setSliderKeyMax] = useState(0);

    useEffect(() => {
        setTextinputWidth(width ? width.toString() : "");
        setTextinputHeight(height ? height.toString() : "");
        setTextinputFramerate(framerate ? framerate.toString() : "");
        setTextinputKeyframeInterval(keyframeInterval ? keyframeInterval.toString() : "");
        setTextinputVideoBitrateMin((videoBitrateMin ?? videoBitrate) ? (videoBitrateMin ?? videoBitrate)!.toString() : "");
        setTextinputVideoBitrateTarget((videoBitrateTarget ?? videoBitrate) ? (videoBitrateTarget ?? videoBitrate)!.toString() : "");
        setTextinputVideoBitrateMax((videoBitrateMax ?? videoBitrate) ? (videoBitrateMax ?? videoBitrate)!.toString() : "");
    }, [width, height, framerate, keyframeInterval, videoBitrate, videoBitrateMin, videoBitrateTarget, videoBitrateMax]);

    useEffect(() => {
        (async () => {
            const mediaEngine = MediaEngineStore.getMediaEngine();

            const stringifiedCodecs: types.CodecCapabilities[] = JSON.parse(
                await new Promise(res => mediaEngine.getCodecCapabilities(res))
            );

            setVideoCodecs(stringifiedCodecs);
        })();
    }, []);

    const settingsCardResolutionSimple =
        <SettingsModalCard
            title="Resolution"
            switchEnabled
            switchProps={{
                checked: resolutionEnabled ?? false,
                disabled: isSaving,
                onChange: status => setResolutionEnabled(status)
            }}>
            <SettingsModalCardItem>
                <Select
                    isDisabled={!resolutionEnabled || isSaving}
                    options={simpleResolutions}
                    select={(value: types.Resolution) => {
                        setWidth(value.width);
                        setHeight(value.height);
                    }}
                    isSelected={(value: types.Resolution) => width === value.width && height === value.height}
                    serialize={() => ""} />
            </SettingsModalCardItem>
        </SettingsModalCard>;

    const settingsCardVideoBitrateSimple =
        <SettingsModalCard
            title="Video Bitrate"
            switchEnabled
            switchProps={{
                checked: videoBitrateEnabled ?? false,
                disabled: isSaving,
                onChange: status => setVideoBitrateEnabled(status)
            }}>
            <SettingsModalCardItem>
                <Select
                    isDisabled={!videoBitrateEnabled || isSaving}
                    options={simpleVideoBitrates}
                    select={(value: number) => void setVideoBitrate(value)}
                    isSelected={(value: number) => (videoBitrateTarget ?? videoBitrate) === value}
                    serialize={() => ""} />
            </SettingsModalCardItem>
        </SettingsModalCard>;

    const settingsCardResolution =
        <SettingsModalCard
            title="Resolution"
            flex={0.5}
            switchEnabled
            switchProps={{
                checked: resolutionEnabled ?? false,
                onChange: status => setResolutionEnabled(status),
                disabled: isSaving
            }}>
            <SettingsModalCardItem title="Width">
                <TextInput
                    disabled={!resolutionEnabled || isSaving}
                    value={textinputWidth}
                    onChange={value => validateTextInputNumber(value) && setTextinputWidth(value)}
                    onBlur={e => {
                        const result = validateNumberInput(e.target.value);
                        setWidth(result);
                        setTextinputWidth(result ? result.toString() : "");
                    }} />
            </SettingsModalCardItem>
            <SettingsModalCardItem title="Height">
                <TextInput
                    disabled={!resolutionEnabled || isSaving}
                    value={textinputHeight}
                    onChange={value => validateTextInputNumber(value) && setTextinputHeight(value)}
                    onBlur={e => {
                        const result = validateNumberInput(e.target.value);
                        setHeight(result);
                        setTextinputHeight(result ? result.toString() : "");
                    }} />
            </SettingsModalCardItem>
        </SettingsModalCard>;

    const settingsCardItemFramerate =
        <SettingsModalCardItem>
            <TextInput
                disabled={!framerateEnabled || isSaving}
                value={textinputFramerate}
                onChange={value => validateTextInputNumber(value) && setTextinputFramerate(value)}
                onBlur={e => {
                    const result = validateNumberInput(e.target.value);
                    setFramerate(result);
                    setTextinputFramerate(result ? result.toString() : "");
                }} />
        </SettingsModalCardItem>;

    const settingsCardFramerateProps: React.ComponentProps<typeof SettingsModalCard> = {
        title: "Framerate",
        switchEnabled: true,
        switchProps: {
            checked: framerateEnabled ?? false,
            disabled: isSaving,
            onChange: status => setFramerateEnabled(status)
        }
    };

    const settingsCardFramerate =
        <SettingsModalCard
            {...settingsCardFramerateProps}
            flex={0.25}
        >
            {settingsCardItemFramerate}
        </SettingsModalCard>;

    const settingsCardFramerateSimple =
        <SettingsModalCard
            {...settingsCardFramerateProps}
        >
            {settingsCardItemFramerate}
        </SettingsModalCard>;

    const settingsCardKeyframeInterval =
        <SettingsModalCard
            title="Keyframe Interval (ms)"
            flex={0.25}
            switchEnabled
            switchProps={{
                checked: keyframeIntervalEnabled ?? false,
                disabled: isSaving,
                onChange: status => setKeyframeIntervalEnabled(status)
            }}>
            <SettingsModalCardItem>
                <TextInput
                    disabled={!keyframeIntervalEnabled || isSaving}
                    value={textinputKeyframeInterval}
                    onChange={value => validateTextInputNumber(value) && setTextinputKeyframeInterval(value)}
                    onBlur={e => {
                        const result = validateNumberInput(e.target.value);
                        setKeyframeInterval(result);
                        setTextinputKeyframeInterval(result ? result.toString() : "");
                    }} />
            </SettingsModalCardItem>
        </SettingsModalCard>;

    const settingsCardVideoBitrate =
        <SettingsModalCard
            title="Video Bitrates"
            flex={0.4}>
            <div style={{ display: "flex", flexDirection: "row", width: "100%", gap: "1em" }}>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1em" }}>
                    {isDetailedBitrate ? (
                        <Flex style={{ flexDirection: "column", gap: "1em", width: "100%" }}>
                            <SettingsModalCardItem title="Min (Kb/s)">
                                <Flex style={{ gap: "1em", alignItems: "center", marginTop: "0.5em" }}>
                                    <div style={{ width: "95px" }}>
                                        <TextInput
                                            disabled={!videoBitrateEnabled || isSaving}
                                            value={textinputVideoBitrateMin}
                                            onChange={value => validateTextInputNumber(value) && setTextinputVideoBitrateMin(value)}
                                            onBlur={e => {
                                                const result = validateNumberInput(e.target.value);
                                                const clamped = result !== undefined ? Math.min(Math.max(result, 500), 10000) : undefined;
                                                setVideoBitrateMin(clamped);
                                                setTextinputVideoBitrateMin(clamped ? clamped.toString() : "");
                                                setSliderKeyMin(prev => prev + 1);
                                            }} />
                                    </div>
                                    <div style={{ flex: 1, paddingTop: "0.3em", paddingRight: "0.4em", paddingLeft: "0.4em", boxSizing: "border-box" }}>
                                        <Slider
                                            key={`slider-min-${sliderKeyMin}`}
                                            disabled={!videoBitrateEnabled || isSaving}
                                            onValueChange={value => setVideoBitrateMin(value)}
                                            initialValue={videoBitrateMin ?? videoBitrate ?? 500}
                                            minValue={500}
                                            maxValue={10000}
                                            markers={[500, 10000]}
                                            onValueRender={value => `${value.toFixed(0)}kb/s`} />
                                    </div>
                                </Flex>
                            </SettingsModalCardItem>
                            <SettingsModalCardItem title="Target (Kb/s)">
                                <Flex style={{ gap: "1em", alignItems: "center", marginTop: "0.5em" }}>
                                    <div style={{ width: "95px" }}>
                                        <TextInput
                                            disabled={!videoBitrateEnabled || isSaving}
                                            value={textinputVideoBitrateTarget}
                                            onChange={value => validateTextInputNumber(value) && setTextinputVideoBitrateTarget(value)}
                                            onBlur={e => {
                                                const result = validateNumberInput(e.target.value);
                                                const clamped = result !== undefined ? Math.min(Math.max(result, 500), 10000) : undefined;
                                                setVideoBitrateTarget(clamped);
                                                setTextinputVideoBitrateTarget(clamped ? clamped.toString() : "");
                                                setSliderKeyTarget(prev => prev + 1);
                                            }} />
                                    </div>
                                    <div style={{ flex: 1, paddingTop: "0.3em", paddingRight: "0.4em", paddingLeft: "0.4em", boxSizing: "border-box" }}>
                                        <Slider
                                            key={`slider-target-${sliderKeyTarget}`}
                                            disabled={!videoBitrateEnabled || isSaving}
                                            onValueChange={value => setVideoBitrateTarget(value)}
                                            initialValue={videoBitrateTarget ?? videoBitrate ?? 500}
                                            minValue={500}
                                            maxValue={10000}
                                            markers={[500, 10000]}
                                            onValueRender={value => `${value.toFixed(0)}kb/s`} />
                                    </div>
                                </Flex>
                            </SettingsModalCardItem>
                            <SettingsModalCardItem title="Max (Kb/s)">
                                <Flex style={{ gap: "1em", alignItems: "center", marginTop: "0.5em" }}>
                                    <div style={{ width: "95px" }}>
                                        <TextInput
                                            disabled={!videoBitrateEnabled || isSaving}
                                            value={textinputVideoBitrateMax}
                                            onChange={value => validateTextInputNumber(value) && setTextinputVideoBitrateMax(value)}
                                            onBlur={e => {
                                                const result = validateNumberInput(e.target.value);
                                                const clamped = result !== undefined ? Math.min(Math.max(result, 500), 10000) : undefined;
                                                setVideoBitrateMax(clamped);
                                                setTextinputVideoBitrateMax(clamped ? clamped.toString() : "");
                                                setSliderKeyMax(prev => prev + 1);
                                            }} />
                                    </div>
                                    <div style={{ flex: 1, paddingTop: "0.3em", paddingRight: "0.4em", paddingLeft: "0.4em", boxSizing: "border-box" }}>
                                        <Slider
                                            key={`slider-max-${sliderKeyMax}`}
                                            disabled={!videoBitrateEnabled || isSaving}
                                            onValueChange={value => setVideoBitrateMax(value)}
                                            initialValue={videoBitrateMax ?? videoBitrate ?? 500}
                                            minValue={500}
                                            maxValue={10000}
                                            markers={[500, 10000]}
                                            onValueRender={value => `${value.toFixed(0)}kb/s`} />
                                    </div>
                                </Flex>
                            </SettingsModalCardItem>
                        </Flex>
                    ) : (
                        <SettingsModalCardItem title="Static (Kb/s)">
                            <Flex style={{ gap: "1em", alignItems: "center", marginTop: "0.5em" }}>
                                <div style={{ width: "95px" }}>
                                    <TextInput
                                        disabled={!videoBitrateEnabled || isSaving}
                                        value={textinputVideoBitrateTarget}
                                        onChange={value => validateTextInputNumber(value) && setTextinputVideoBitrateTarget(value)}
                                        onBlur={e => {
                                            const result = validateNumberInput(e.target.value);
                                            const clamped = result !== undefined ? Math.min(Math.max(result, 500), 10000) : undefined;
                                            setVideoBitrateMin(clamped);
                                            setVideoBitrateTarget(clamped);
                                            setVideoBitrateMax(clamped);
                                            setVideoBitrate(clamped);

                                            const stringVal = clamped ? clamped.toString() : "";
                                            setTextinputVideoBitrateMin(stringVal);
                                            setTextinputVideoBitrateTarget(stringVal);
                                            setTextinputVideoBitrateMax(stringVal);

                                            setSliderKeyTarget(prev => prev + 1);
                                        }} />
                                </div>
                                <div style={{ flex: 1, paddingTop: "0.3em", paddingRight: "0.4em", paddingLeft: "0.4em", boxSizing: "border-box" }}>
                                    <Slider
                                        key={`slider-all-${sliderKeyTarget}`}
                                        disabled={!videoBitrateEnabled || isSaving}
                                        onValueChange={value => {
                                            setVideoBitrateMin(value);
                                            setVideoBitrateTarget(value);
                                            setVideoBitrateMax(value);
                                            setVideoBitrate(value);
                                        }}
                                        initialValue={videoBitrateTarget ?? videoBitrate ?? 500}
                                        minValue={500}
                                        maxValue={10000}
                                        markers={[500, 10000]}
                                        onValueRender={value => `${value.toFixed(0)}kb/s`} />
                                </div>
                            </Flex>
                        </SettingsModalCardItem>
                    )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", width: "80px", gap: "1em", alignItems: "center", justifyContent: "flex-start", paddingTop: "0.6em" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <Heading tag="h5">Status</Heading>
                        <Switch
                            checked={videoBitrateEnabled ?? false}
                            disabled={isSaving}
                            onChange={status => setVideoBitrateEnabled(status)}
                        />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <Heading tag="h5" style={{ textAlign: "center", lineHeight: "1.2" }}>Detailed Settings</Heading>
                        <Switch
                            checked={isDetailedBitrate}
                            disabled={!videoBitrateEnabled || isSaving}
                            onChange={checked => setIsDetailedBitrate(checked)}
                        />
                    </div>
                </div>
            </div>
        </SettingsModalCard>;

    const settingsCardAudioProps: React.ComponentProps<typeof SettingsModalCard> = {
        title: "Audio Settings"
    };

    const settingsCardItemAudio =
        <SettingsModalCardItem >
            <Button
                variant="primary"
                size="small"
                onClick={() => {
                    if (screenshareAudioStore)
                        openModalLazy(async () => {
                            return props_ =>
                                <MicrophoneSettingsModal
                                    author={props.author}
                                    contributors={props.contributors}
                                    title="Screenshare Audio Settings"
                                    onDone={onAudioDone}
                                    microphoneStore={screenshareAudioStore}
                                    {...props_} />;
                        });
                }}
            >
                Open
            </Button>
        </SettingsModalCardItem>;

    const settingsCardAudio =
        <SettingsModalCard
            {...settingsCardAudioProps}
            flex={0.2}>
            {settingsCardItemAudio}
        </SettingsModalCard>;

    const settingsCardAudioSimple =
        <SettingsModalCard
            {...settingsCardAudioProps}>
            {settingsCardItemAudio}
        </SettingsModalCard>;

    const settingsCardVideoCodec =
        <SettingsModalCard
            title="Video Codec"
            flex={0.4}
            switchEnabled
            switchProps={{
                checked: videoCodecEnabled ?? false,
                disabled: isSaving,
                onChange: status => setVideoCodecEnabled(status)
            }}>
            <SettingsModalCardItem>
                <Select
                    isDisabled={!videoCodecEnabled || isSaving}
                    isSelected={value => value === videoCodec}
                    options={codecOptions}
                    select={value => setVideoCodec(value)}
                    serialize={value => String(value)}
                    renderOptionLabel={option => {
                        const codecOption = option as CodecSelectOption;
                        const supportsEncode = codecOption.encode;

                        return (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5em" }}>
                                <span
                                    style={{
                                        color: supportsEncode ? "var(--status-positive)" : "var(--status-danger)",
                                        fontWeight: 700
                                    }}
                                >
                                    {supportsEncode ? "\u2713" : "\u2717"}
                                </span>
                                <span>{codecOption.label}</span>
                            </div>
                        );
                    }} />
            </SettingsModalCardItem>
        </SettingsModalCard>;

    const settingsCardHdr =
        <SettingsModalCard
            title="Hdr"
            flex={0.1}
            switchEnabled
            switchProps={{
                checked: hdrEnabled ?? false,
                disabled: isSaving,
                onChange: status => setHdrEnabled(status)
            }} />;

    const guideCard =
        <Card style={{ ...Styles.infoCard, flex: 0.4 }}>
            <Paragraph>Note: Using a custom bitrate requires the VoicePatcher plugin to be enabled.</Paragraph>
        </Card>;

    const settingsCardProfiles =
        <SettingsModalProfilesCard flex={0.5} onSaveStateChanged={state => setIsSaving(state)} profileableStore={screenshareStore} />;

    const simpleToggle =
        <Flex style={{ justifyContent: "center", alignItems: "center", gap: "0.6em" }}>
            <Heading style={{ margin: 0 }} tag="h5">Simple</Heading>
            <Switch checked={simpleMode ?? false} disabled={isSaving} onChange={checked => setSimpleMode(checked)} />
        </Flex>;


    return (
        <SettingsModal
            size={simpleMode ? ModalSize.DYNAMIC : ModalSize.LARGE}
            title="Screenshare Settings"
            closeButtonName="Apply"
            footerContent={
                <Flex style={{ justifyContent: "center", alignItems: "center", marginLeft: "auto" }}>
                    {simpleToggle}
                </Flex>
            }
            {...props}
            onDone={() => {
                props.onClose();
                props.onDone && props.onDone();
            }}
        >
            {simpleMode
                ? <div style={{ width: "55em" }}>
                    <SettingsModalCardRow>
                        {settingsCardResolutionSimple}
                        {settingsCardFramerateSimple}
                        {settingsCardVideoBitrateSimple}
                        {screenshareAudioStore && settingsCardAudioSimple}
                    </SettingsModalCardRow>
                </div>
                : <>
                    <SettingsModalCardRow>
                        {settingsCardResolution}
                        {settingsCardFramerate}
                        {settingsCardKeyframeInterval}
                    </SettingsModalCardRow>
                    <SettingsModalCardRow>
                        {settingsCardVideoBitrate}
                        {settingsCardVideoCodec}
                        {screenshareAudioStore && settingsCardAudio}
                    </SettingsModalCardRow>
                    <SettingsModalCardRow>
                        {guideCard}
                        {settingsCardHdr}
                        {settingsCardProfiles}
                    </SettingsModalCardRow>
                </>
            }
        </SettingsModal>
    );
};
