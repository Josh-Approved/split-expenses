module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated 4 ships its worklets babel plugin here; it MUST
    // be last in the plugin list.
    plugins: ['react-native-worklets/plugin'],
  };
};
