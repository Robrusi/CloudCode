export const CLOUDCODE_CONFIG_DIRECTORY = ".cloudcode"
export const CLOUDCODE_YAML_PATH = `${CLOUDCODE_CONFIG_DIRECTORY}/cloudcode.yaml`
export const LEGACY_CLOUDCODE_YAML_PATH = "cloudcode.yaml"

function appendRepoPath(repoPath: string, relativePath: string) {
  return `${repoPath}${repoPath.endsWith("/") ? "" : "/"}${relativePath}`
}

export function cloudcodeConfigDirectoryPath(repoPath: string) {
  return appendRepoPath(repoPath, CLOUDCODE_CONFIG_DIRECTORY)
}

export function cloudcodeYamlPath(repoPath: string) {
  return appendRepoPath(repoPath, CLOUDCODE_YAML_PATH)
}

export function legacyCloudcodeYamlPath(repoPath: string) {
  return appendRepoPath(repoPath, LEGACY_CLOUDCODE_YAML_PATH)
}
