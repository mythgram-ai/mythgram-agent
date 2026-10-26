import { ToolRegistry } from "./registry.js";
import { fileReadTool } from "./fileRead.js";
import { fileWriteTool } from "./fileWrite.js";
import { fileListTool } from "./fileList.js";
import { grepTool } from "./grep.js";
import { astgrepTool } from "./astgrep.js";
import { globTool } from "./glob.js";
import { strReplaceTool } from "./strReplace.js";
import { applyMultipleEditsTool } from "./applyMultipleEdits.js";
import { applyPatchTool } from "./applyPatch.js";
import { shellTool } from "./shell.js";
import { shellViewTool } from "./shellView.js";
import { bashWriteToProcessTool } from "./bashWriteToProcess.js";
import { webSearchTool } from "./webSearch.js";
import { imageSearchTool } from "./imagesearch.js";
import { fetchWebUrlsTool } from "./fetchWebUrls.js";
import { readImageTool } from "./readImage.js";
import { scanQrCodeTool } from "./scanQrCode.js";
import { callSubAgentTool } from "./call_sub_agent.js";
import { callMultipleSubAgentsTool } from "./call_multiple_sub_agents.js";
import { listSubAgentsTool } from "./list_sub_agents.js";
import { listSkillsTool } from "./list_skills.js";
import { skillInitializeTool } from "./skill_initialize.js";
import { submitPlanTool } from "./submit_plan.js";
import { askUserTool } from "./askuser.js";
import { buildSubAgentTool } from "./buildsubagent.js";
import { createSkillTool } from "./createskill.js";
import { todoWriteTool } from "./todowrite.js";
import { readTodosTool } from "./todoread.js";
import { memoryListTool } from "./memory_list.js";
import { memorySearchTool } from "./memory_search.js";
import { memoryReadTool } from "./memory_read.js";
import { memoryWriteTool } from "./memory_write.js";
import { memoryEditTool } from "./memory_edit.js";
import { memoryDeleteTool } from "./memory_delete.js";
import { knowledgeListTool } from "./knowledge_list.js";
import { knowledgeSearchTool } from "./knowledge_search.js";
import { knowledgeReadTool } from "./knowledge_read.js";
import { knowledgeCreateTool } from "./knowledge_create.js";
import { knowledgeEditTool } from "./knowledge_edit.js";
import { knowledgeDeleteTool } from "./knowledge_delete.js";
import { savePromptInPromptLibraryTool } from "./save_prompt_in_prompt_library.js";
import { deletePromptFromPromptLibraryTool } from "./delete_prompt_from_prompt_library.js";
import { listAvailablePromptsInPromptLibraryTool } from "./list_available_prompts_in_prompt_library.js";
import { saveCustomSystemPromptTool } from "./save_custom_system_prompt.js";
import { deleteCustomSystemPromptTool } from "./delete_custom_system_prompt.js";
import { listAvailableCustomSystemPromptTool } from "./list_available_custom_system_prompt.js";
import { embedUrlTool } from "./embedUrl.js";
import { attachFilesTool } from "./attachFiles.js";
import { waitTool } from "./wait.js";
import { createCheckpointTool } from "./create_checkpoint.js";
import { listCheckpointsTool } from "./list_checkpoints.js";
import { deleteCheckpointTool } from "./delete_checkpoint.js";
import { restoreCheckpointTool } from "./restore_checkpoint.js";
import { deleteSubAgentTool } from "./delete_sub_agent.js";
import { listSubAgentSessionsTool } from "./list_sub_agent_sessions.js";
import { reuseSameSubAgentSessionTool } from "./reuse_same_sub_agent_session.js";
import { deleteSkillTool } from "./delete_skill.js";
import { createAgentTool } from "./create_agent.js";
import { listAvailableAgentsTool } from "./list_available_agents.js";
import { deleteAgentTool } from "./delete_agent.js";
import { delegateTaskOrSendMessageTool } from "./delegate_task_or_send_message.js";
import { getTeamMembersStatusTool } from "./get_team_members_status.js";
import { sendMessageToTeamTool } from "./send_message_to_team.js";
import { listAgentTeamMembersTool } from "./list_agent_team_members.js";
import { messageTeamLeaderTool } from "./message_team_leader.js";
import { assignTasksToTeamsTool } from "./assign_tasks_to_teams.js";
import { listTeamsTool } from "./list_teams.js";
import { reportTaskCompletionToCeoTool } from "./report_task_completion_to_ceo.js";
import { scheduleCreateTool } from "./schedule_create.js";
import { scheduleListTool } from "./schedule_list.js";
import { scheduleUpdateTool } from "./schedule_update.js";
import { scheduleOnTool } from "./schedule_on.js";
import { scheduleOffTool } from "./schedule_off.js";
import { scheduleRunNowTool } from "./schedule_run_now.js";
import { scheduleDeleteTool } from "./schedule_delete.js";
import { scheduleGetTool } from "./schedule_get.js";
import { sendResponsesTool } from "./sendResponses.js";
import { connectRemoteMcpTool } from "./mcp_connect_remote.js";
import { connectLocalMcpServerTool } from "./mcp_connect_local.js";
import { listAvailableMcpServersTool } from "./mcp_list.js";
import { deleteMcpServerTool } from "./mcp_delete.js";
import { toggleMcpServerTool } from "./mcp_toggle.js";
import { getMcpServerStatusTool } from "./mcp_status.js";
import { listAvailableApplicationConnectorsTool } from "./list_available_application_connectors.js";
import { connectApplicationsConnectorsTool } from "./connect_applications_connectors.js";
import { disconnectApplicationConnectorTool } from "./disconnect_application_connector.js";
import { getApplicationConnectorStatusTool } from "./get_application_connector_status.js";
import { listAvailableChannelsTool } from "./list_available_channels.js";
import { requestChannelConnectionToUserTool } from "./request_channel_connection_to_user.js";
import { disconnectChannelsTool } from "./disconnect_channels.js";
import { getChannelStatusTool } from "./get_channel_status.js";
import { sendMessageToCommunicationChannelTool } from "./send_message_to_communication_channel.js";

export { ToolRegistry } from "./registry.js";
export type {
  Tool,
  ToolContext,
  ToolResult,
  WebToolsConfig,
  SearchProvider,
  SubAgentDefinition,
  SubAgentRuntime,
  SkillDefinition,
  SkillFileDefinition,
  SkillRuntime,
  TodoItem,
  TodoRuntime,
  MemoryFile,
  MemoryRuntime,
  KnowledgeFile,
  KnowledgeRuntime,
  KnowledgeReadOptions,
  CustomAgentInfo,
  CustomAgentCreateInput,
  CustomAgentsRuntime,
  ScheduleAgentIdentity,
  ScheduleCreateCadence,
  ScheduleCreateInput,
  ScheduleRuntime,
} from "./types.js";
export { defineTool } from "./types.js";
export { webSearchTool, SEARCH_PROVIDERS } from "./webSearch.js";
export {
  imageSearchTool,
  IMAGE_SEARCH_PROVIDERS,
  IMAGE_SEARCH_PROVIDER_DUCKDUCKGO,
  IMAGE_SEARCH_PROVIDER_TAVILY,
  IMAGE_SEARCH_PROVIDER_EXA,
  IMAGE_SEARCH_PROVIDER_SERPAPI,
} from "./imagesearch.js";
export { fetchWebUrlsTool } from "./fetchWebUrls.js";
export { applyMultipleEditsTool } from "./applyMultipleEdits.js";
export { applyPatchTool, parsePatch, summarizePatch, PatchError } from "./applyPatch.js";
export { readImageTool, SUPPORTED_IMAGE_EXTENSIONS } from "./readImage.js";
export { scanQrCodeTool, SUPPORTED_QR_EXTENSIONS, MAX_QR_IMAGE_BYTES } from "./scanQrCode.js";
export { grepTool, MAX_GREP_MATCHES, MAX_GREP_LINE_CHARS, includeToRegExp } from "./grep.js";
export { globTool, MAX_GLOB_MATCHES } from "./glob.js";
export {
  astgrepTool,
  ASTGREP_LANGUAGES,
  MAX_ASTGREP_MATCHES,
  MAX_ASTGREP_LINE_CHARS,
  compileAstPattern,
  detectLanguage,
  normalizeLanguage,
} from "./astgrep.js";
export { callSubAgentTool } from "./call_sub_agent.js";
export { callMultipleSubAgentsTool } from "./call_multiple_sub_agents.js";
export { listSubAgentsTool } from "./list_sub_agents.js";
export { listSkillsTool } from "./list_skills.js";
export { skillInitializeTool } from "./skill_initialize.js";
export { buildSubAgentTool } from "./buildsubagent.js";
export { createSkillTool } from "./createskill.js";
export { todoWriteTool } from "./todowrite.js";
export { readTodosTool } from "./todoread.js";
export { memoryListTool, requireMemory, memoryFailure } from "./memory_list.js";
export { memorySearchTool } from "./memory_search.js";
export { memoryReadTool } from "./memory_read.js";
export { memoryWriteTool } from "./memory_write.js";
export { memoryEditTool } from "./memory_edit.js";
export { memoryDeleteTool } from "./memory_delete.js";
export { knowledgeListTool } from "./knowledge_list.js";
export { knowledgeSearchTool } from "./knowledge_search.js";
export { knowledgeReadTool } from "./knowledge_read.js";
export { knowledgeCreateTool } from "./knowledge_create.js";
export { knowledgeEditTool } from "./knowledge_edit.js";
export { knowledgeDeleteTool } from "./knowledge_delete.js";
export { savePromptInPromptLibraryTool } from "./save_prompt_in_prompt_library.js";
export { deletePromptFromPromptLibraryTool } from "./delete_prompt_from_prompt_library.js";
export {
  listAvailablePromptsInPromptLibraryTool,
  requirePromptLibrary,
} from "./list_available_prompts_in_prompt_library.js";
export { saveCustomSystemPromptTool } from "./save_custom_system_prompt.js";
export { deleteCustomSystemPromptTool } from "./delete_custom_system_prompt.js";
export {
  listAvailableCustomSystemPromptTool,
  requireCustomSystemPrompts,
} from "./list_available_custom_system_prompt.js";
export { submitPlanTool } from "./submit_plan.js";
export { askUserTool, ASK_ANSWERED, ASK_TIMEOUT, ASK_CHANNEL_UNAVAILABLE } from "./askuser.js";
export { embedUrlTool } from "./embedUrl.js";
export { attachFilesTool, formatFileSizeLabel } from "./attachFiles.js";
export { waitTool, WAIT_MIN_SECONDS, WAIT_MAX_SECONDS } from "./wait.js";
export { createCheckpointTool } from "./create_checkpoint.js";
export { listCheckpointsTool } from "./list_checkpoints.js";
export { deleteCheckpointTool } from "./delete_checkpoint.js";
export { restoreCheckpointTool } from "./restore_checkpoint.js";
export { deleteSubAgentTool, DELETE_DEFAULT_SUB_AGENT_ERROR } from "./delete_sub_agent.js";
export { listSubAgentSessionsTool } from "./list_sub_agent_sessions.js";
export { reuseSameSubAgentSessionTool } from "./reuse_same_sub_agent_session.js";
export { deleteSkillTool, DELETE_DEFAULT_SKILL_ERROR } from "./delete_skill.js";
export { createAgentTool } from "./create_agent.js";
export { listAvailableAgentsTool } from "./list_available_agents.js";
export { deleteAgentTool } from "./delete_agent.js";
export {
  CUSTOM_AGENT_MANAGEMENT_TOOL_NAMES,
  isCustomAgentManagementTool,
  requireCustomAgents,
} from "./customAgentManagement.js";
export { delegateTaskOrSendMessageTool } from "./delegate_task_or_send_message.js";
export { getTeamMembersStatusTool } from "./get_team_members_status.js";
export { sendMessageToTeamTool } from "./send_message_to_team.js";
export { listAgentTeamMembersTool } from "./list_agent_team_members.js";
export { messageTeamLeaderTool } from "./message_team_leader.js";
export { assignTasksToTeamsTool } from "./assign_tasks_to_teams.js";
export { listTeamsTool } from "./list_teams.js";
export { reportTaskCompletionToCeoTool } from "./report_task_completion_to_ceo.js";
export { scheduleCreateTool } from "./schedule_create.js";
export { scheduleListTool } from "./schedule_list.js";
export { scheduleUpdateTool } from "./schedule_update.js";
export { scheduleOnTool } from "./schedule_on.js";
export { scheduleOffTool } from "./schedule_off.js";
export { scheduleRunNowTool } from "./schedule_run_now.js";
export { scheduleDeleteTool } from "./schedule_delete.js";
export { scheduleGetTool } from "./schedule_get.js";
export { connectRemoteMcpTool } from "./mcp_connect_remote.js";
export { connectLocalMcpServerTool } from "./mcp_connect_local.js";
export { listAvailableMcpServersTool } from "./mcp_list.js";
export { deleteMcpServerTool } from "./mcp_delete.js";
export { toggleMcpServerTool } from "./mcp_toggle.js";
export { getMcpServerStatusTool } from "./mcp_status.js";
export { listAvailableApplicationConnectorsTool } from "./list_available_application_connectors.js";
export { connectApplicationsConnectorsTool } from "./connect_applications_connectors.js";
export { disconnectApplicationConnectorTool } from "./disconnect_application_connector.js";
export { getApplicationConnectorStatusTool } from "./get_application_connector_status.js";
export {
  CONNECTOR_MANAGEMENT_TOOL_NAMES,
  isConnectorManagementTool,
  CONNECTOR_CONNECTION_TIMEOUT_MS,
  connectorCatalog,
  normalizeConnectorName,
} from "./connectorManagement.js";
export { listAvailableChannelsTool } from "./list_available_channels.js";
export { requestChannelConnectionToUserTool } from "./request_channel_connection_to_user.js";
export { disconnectChannelsTool } from "./disconnect_channels.js";
export { getChannelStatusTool } from "./get_channel_status.js";
export { sendMessageToCommunicationChannelTool } from "./send_message_to_communication_channel.js";
export {
  CHANNEL_MANAGEMENT_TOOL_NAMES,
  isChannelManagementTool,
  CHANNEL_CONNECTION_TIMEOUT_MS,
} from "./channelManagement.js";
export {
  MCP_MANAGEMENT_TOOL_NAMES,
  isMcpManagementTool,
} from "./mcpManagement.js";
export {
  CHANNEL_ONLY_TOOLS,
  buildChannelSystemSection,
  sendResponsesTool,
} from "./sendResponses.js";
export { createScheduleRuntime, requireSchedules } from "./scheduleRuntime.js";
export type { ScheduleRuntimeDeps } from "./scheduleRuntime.js";
export {
  TEAM_TOOL_NAMES,
  CEO_TOOL_NAMES,
  ALL_MULTI_AGENT_TOOL_NAMES,
  isTeamTool,
  isCeoTool,
  allowedTeamAgentTools,
  allowedCeoAgentTools,
  LEADER_TEAM_TOOLS,
  MEMBER_TEAM_TOOLS,
  OPTIONAL_TEAM_TOOL,
  CEO_AGENT_TOOLS,
  CEO_LEADER_TOOL,
} from "./teamTools.js";
export type { CeoAgentRole } from "./teamTools.js";
export type { AttachedFileInfo, AttachFileFailure } from "./attachFiles.js";
export { shellViewTool } from "./shellView.js";
export { bashWriteToProcessTool } from "./bashWriteToProcess.js";
export {
  shellSessionStore,
  ShellSessionStore,
  MAX_SESSION_BUFFER_CHARS,
} from "./shellSessions.js";
export type { ShellSessionSnapshot, ShellSessionStatus } from "./shellSessions.js";
export type { ProcessWriteResult } from "./shellSessions.js";

/** Build the default registry with the agent's file/web/shell tools plus the sub-agent tools. */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry().registerAll([
    fileReadTool,
    fileWriteTool,
    fileListTool,
    grepTool,
    astgrepTool,
    globTool,
    strReplaceTool,
    applyMultipleEditsTool,
    applyPatchTool,
    shellTool,
    shellViewTool,
    bashWriteToProcessTool,
    webSearchTool,
    imageSearchTool,
    fetchWebUrlsTool,
    readImageTool,
    scanQrCodeTool,
    callSubAgentTool,
    callMultipleSubAgentsTool,
    listSubAgentsTool,
    listSkillsTool,
    skillInitializeTool,
    submitPlanTool,
    askUserTool,
    buildSubAgentTool,
    createSkillTool,
    todoWriteTool,
    readTodosTool,
    memoryListTool,
    memorySearchTool,
    memoryReadTool,
    memoryWriteTool,
    memoryEditTool,
    memoryDeleteTool,
    knowledgeListTool,
    knowledgeSearchTool,
    knowledgeReadTool,
    knowledgeCreateTool,
    knowledgeEditTool,
    knowledgeDeleteTool,
    savePromptInPromptLibraryTool,
    deletePromptFromPromptLibraryTool,
    listAvailablePromptsInPromptLibraryTool,
    saveCustomSystemPromptTool,
    deleteCustomSystemPromptTool,
    listAvailableCustomSystemPromptTool,
    embedUrlTool,
    attachFilesTool,
    waitTool,
    createCheckpointTool,
    listCheckpointsTool,
    deleteCheckpointTool,
    restoreCheckpointTool,
    deleteSubAgentTool,
    listSubAgentSessionsTool,
    reuseSameSubAgentSessionTool,
    deleteSkillTool,
    createAgentTool,
    listAvailableAgentsTool,
    deleteAgentTool,
    delegateTaskOrSendMessageTool,
    getTeamMembersStatusTool,
    sendMessageToTeamTool,
    listAgentTeamMembersTool,
    messageTeamLeaderTool,
    assignTasksToTeamsTool,
    listTeamsTool,
    reportTaskCompletionToCeoTool,
    scheduleCreateTool,
    scheduleListTool,
    scheduleUpdateTool,
    scheduleOnTool,
    scheduleOffTool,
    scheduleRunNowTool,
    scheduleDeleteTool,
    scheduleGetTool,
    connectRemoteMcpTool,
    connectLocalMcpServerTool,
    listAvailableMcpServersTool,
    deleteMcpServerTool,
    toggleMcpServerTool,
    getMcpServerStatusTool,
    listAvailableApplicationConnectorsTool,
    connectApplicationsConnectorsTool,
    disconnectApplicationConnectorTool,
    getApplicationConnectorStatusTool,
    listAvailableChannelsTool,
    requestChannelConnectionToUserTool,
    disconnectChannelsTool,
    getChannelStatusTool,
    sendMessageToCommunicationChannelTool,
    sendResponsesTool,
  ]);
}

export const tools = {
  fileReadTool,
  fileWriteTool,
  fileListTool,
  grepTool,
  astgrepTool,
  globTool,
  strReplaceTool,
  applyMultipleEditsTool,
  applyPatchTool,
  shellTool,
  shellViewTool,
  bashWriteToProcessTool,
  webSearchTool,
  imageSearchTool,
  fetchWebUrlsTool,
  readImageTool,
  scanQrCodeTool,
  callSubAgentTool,
  callMultipleSubAgentsTool,
  listSubAgentsTool,
  listSkillsTool,
  skillInitializeTool,
  submitPlanTool,
  askUserTool,
  buildSubAgentTool,
  createSkillTool,
  todoWriteTool,
  readTodosTool,
  memoryListTool,
  memorySearchTool,
  memoryReadTool,
  memoryWriteTool,
  memoryEditTool,
  memoryDeleteTool,
  knowledgeListTool,
  knowledgeSearchTool,
  knowledgeReadTool,
  knowledgeCreateTool,
  knowledgeEditTool,
  knowledgeDeleteTool,
  savePromptInPromptLibraryTool,
  deletePromptFromPromptLibraryTool,
  listAvailablePromptsInPromptLibraryTool,
  saveCustomSystemPromptTool,
  deleteCustomSystemPromptTool,
  listAvailableCustomSystemPromptTool,
  embedUrlTool,
  attachFilesTool,
  waitTool,
  createCheckpointTool,
  listCheckpointsTool,
  deleteCheckpointTool,
  restoreCheckpointTool,
  deleteSubAgentTool,
  listSubAgentSessionsTool,
  reuseSameSubAgentSessionTool,
  deleteSkillTool,
  createAgentTool,
  listAvailableAgentsTool,
  deleteAgentTool,
  delegateTaskOrSendMessageTool,
  getTeamMembersStatusTool,
  sendMessageToTeamTool,
  listAgentTeamMembersTool,
  messageTeamLeaderTool,
  assignTasksToTeamsTool,
  listTeamsTool,
  reportTaskCompletionToCeoTool,
  scheduleCreateTool,
  scheduleListTool,
  scheduleUpdateTool,
  scheduleOnTool,
  scheduleOffTool,
  scheduleRunNowTool,
  scheduleDeleteTool,
  scheduleGetTool,
  connectRemoteMcpTool,
  connectLocalMcpServerTool,
  listAvailableMcpServersTool,
  deleteMcpServerTool,
  toggleMcpServerTool,
  getMcpServerStatusTool,
  listAvailableApplicationConnectorsTool,
  connectApplicationsConnectorsTool,
  disconnectApplicationConnectorTool,
  getApplicationConnectorStatusTool,
  listAvailableChannelsTool,
  requestChannelConnectionToUserTool,
  disconnectChannelsTool,
  getChannelStatusTool,
  sendMessageToCommunicationChannelTool,
  sendResponsesTool,
};
