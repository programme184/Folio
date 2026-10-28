module.exports = ({ config }) => {
  const variant = process.env.AGENTSDOCK_APP_VARIANT
  if (!variant || variant === 'production') return config
  if (variant !== 'development') throw new Error(`Unknown AgentsDock app variant: ${variant}`)

  return {
    ...config,
    name: 'AgentsDock Dev',
    scheme: 'agentsdock-dev',
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
    },
    android: {
      ...config.android,
      package: `${config.android.package}.dev`,
    },
  }
}
