import * as React from "react";

import { configureAppSettings } from "@/lib/api";
import { formatUnknownError } from "@/lib/errors";
import {
  defaultAppSettings,
  loadAppSettings,
  resetAppSettings,
  saveAppSettings,
  settingsEnv,
  type AppSettings,
} from "@/lib/settings";

import type { AppStage } from "./types";

export function useAppSettings({
  stage,
  setStage,
}: {
  stage: AppStage;
  setStage: React.Dispatch<React.SetStateAction<AppStage>>;
}) {
  const [settingsReturnStage, setSettingsReturnStage] = React.useState<AppStage>("launcher");
  const [appSettings, setAppSettings] = React.useState<AppSettings>(defaultAppSettings);
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);
  const [settingsSavedAt, setSettingsSavedAt] = React.useState<string | undefined>();

  const openSettings = React.useCallback(() => {
    setSettingsReturnStage((current) => (stage === "settings" ? current : stage));
    setStage("settings");
  }, [setStage, stage]);

  const closeSettings = React.useCallback(() => {
    setStage(settingsReturnStage === "settings" ? "launcher" : settingsReturnStage);
  }, [setStage, settingsReturnStage]);

  const handleSaveSettings = React.useCallback((nextSettings: AppSettings) => {
    const normalizedEnv = settingsEnv(nextSettings);
    const settingsToSave = {
      ...nextSettings,
      env: normalizedEnv,
    };

    setSettingsSavedAt("Saving");
    saveAppSettings(settingsToSave)
      .then((savedSettings) => configureAppSettings({ env: settingsEnv(savedSettings) }).then(() => savedSettings))
      .then((savedSettings) => {
        setAppSettings(savedSettings);
        setSettingsSavedAt("Saved");
      })
      .catch((error: Error) => {
        setSettingsSavedAt(formatUnknownError(error));
      });
  }, []);

  const handleResetSettings = React.useCallback(() => {
    setSettingsSavedAt("Resetting");
    resetAppSettings()
      .then((nextSettings) => configureAppSettings({ env: {} }).then(() => nextSettings))
      .then((nextSettings) => {
        setAppSettings(nextSettings);
        setSettingsSavedAt("Reset");
      })
      .catch((error: Error) => {
        setSettingsSavedAt(formatUnknownError(error));
      });
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    loadAppSettings()
      .then((loadedSettings) => {
        if (!cancelled) {
          setAppSettings(loadedSettings);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setSettingsSavedAt(formatUnknownError(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    appSettings,
    settingsLoaded,
    settingsSavedAt,
    closeSettings,
    handleResetSettings,
    handleSaveSettings,
    openSettings,
  };
}
