/** The one place an agent is started: its prompt, its options and the mapping of its reply, for each kind of work and helper. */
import { DISPATCH_PROTOCOL }                          from '../../src/shared/constants/DispatchProtocol.ts';
import type { DispatchLogger }                        from '../@types/DispatchLogger.ts';
import type { AgentModelAndEffort, DispatchSettings } from '../@types/DispatchSettings.ts';
import type {
  AgentLaunch,
  AgentSubject,
  AgentWork,
  FinishedAgent,
  GroupPlacement,
  ParkWork
} from '../@types/DispatchWork.ts';
import type { AgentOptions, JsonSchema, WorkflowRuntime } from '../@types/WorkflowRuntime.ts';
import { DISPATCH_POLICY }                                from '../constants/DispatchPolicy.ts';
import { DispatchWordingUtil }                            from '../utils/DispatchWordingUtil.ts';
import { WorkflowInputUtil }                              from '../utils/WorkflowInputUtil.ts';
import { AGENT_REPLY_SCHEMAS }                            from './constants/AgentReplySchemas.ts';
import { AgentPromptUtil }                                from './utils/AgentPromptUtil.ts';
import { GroupAgentPromptUtil }                           from './utils/GroupAgentPromptUtil.ts';

export type SurveyAgentRequest = { kind: 'survey' } | { kind: 'ticket-settings'; ticketIds: readonly string[] } | { kind: 'group-survey'; groupName: string };

export interface AgentStarter {
  startAgent:     (launch: AgentLaunch) => Promise<FinishedAgent>;
  runSurveyAgent: (request: SurveyAgentRequest) => Promise<unknown>;
}

export function createAgentStarter(runtime: WorkflowRuntime, settings: DispatchSettings, logger: DispatchLogger): AgentStarter {
  async function runAgent(prompt: string, options: AgentOptions, subject: AgentSubject): Promise<unknown> {
    try {
      return await runtime.agent(prompt, options);
    } catch (error) {
      logger.agentFailed(subject, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  function surveyPromptOf(request: SurveyAgentRequest): string {
    if (request.kind === 'group-survey') return GroupAgentPromptUtil.groupSurveyPrompt(settings, request.groupName);
    return request.kind === 'survey' ? AgentPromptUtil.surveyPrompt(settings) : AgentPromptUtil.ticketSettingsLookupPrompt(settings, request.ticketIds);
  }

  function surveySchemaOf(request: SurveyAgentRequest): JsonSchema {
    if (request.kind === 'group-survey') return AGENT_REPLY_SCHEMAS.GROUP_SURVEY;
    return request.kind === 'survey' ? AGENT_REPLY_SCHEMAS.SURVEY : AGENT_REPLY_SCHEMAS.TICKET_SETTINGS_LOOKUP;
  }

  function runSurveyAgent(request: SurveyAgentRequest): Promise<unknown> {
    return runAgent(surveyPromptOf(request), {
      label:  DispatchWordingUtil.agentLabelOf(request),
      phase:  'Survey',
      schema: surveySchemaOf(request),
      model:  DISPATCH_POLICY.SURVEY_AGENT.model,
      effort: DISPATCH_POLICY.SURVEY_AGENT.effort,
    }, request);
  }

  function parkingAgentRunFor(work: ParkWork): Promise<unknown> {
    const prompt = AgentPromptUtil.parkingPrompt(settings, work.ticketId, DispatchWordingUtil.boardLogLineOf(work.ticketId, work.release));
    return runAgent(prompt, {
      label:  DispatchWordingUtil.agentLabelOf(work),
      phase:  'Park',
      schema: AGENT_REPLY_SCHEMAS.PARKING,
      model:  DISPATCH_POLICY.PARKING_AGENT.model,
      effort: DISPATCH_POLICY.PARKING_AGENT.effort,
    }, work);
  }

  // A builder and a reviewer run on the model and effort the ticket states, and are named its owner by that model. They start as the installed
  // worker type, whose narrow tool list leaves out the skill listing and the unrelated tools a default workflow subagent carries on every call.
  function workerRunFor(
    work: AgentWork,
    agentModelAndEffort: AgentModelAndEffort,
    pausedBuildWasFoundBySurvey: boolean,
    groupPlacement: GroupPlacement | undefined,
  ): Promise<unknown> {
    const { model, effort } = agentModelAndEffort;
    if (work.kind === 'build') {
      const request = {
        ticketId:     work.ticketId,
        previousPass: work.previousPass,
        owner:        model,
        pausedBuildWasFoundBySurvey,
      };
      const prompt = groupPlacement === undefined ? AgentPromptUtil.builderPrompt(settings, request) : GroupAgentPromptUtil.groupBuilderPrompt(settings, groupPlacement, request);
      return runAgent(prompt, {
        label:     DispatchWordingUtil.agentLabelOf(work),
        phase:     'Build',
        schema:    AGENT_REPLY_SCHEMAS.BUILDER,
        model,
        effort,
        agentType: DISPATCH_PROTOCOL.WORKER_AGENT_TYPE,
      }, work);
    }
    const request = {
      ticketId:            work.ticketId,
      expectedRound:       work.round,
      rereviewRunsFirst:   work.rereviewRunsFirst,
      earlierReviewerDied: work.earlierReviewerDied,
      owner:               model,
    };
    const prompt = groupPlacement === undefined ? AgentPromptUtil.reviewerPrompt(settings, request) : GroupAgentPromptUtil.groupReviewerPrompt(settings, groupPlacement, request);
    return runAgent(prompt, {
      label:     DispatchWordingUtil.agentLabelOf(work),
      phase:     'Review',
      schema:    groupPlacement !== undefined ? AGENT_REPLY_SCHEMAS.GROUP_REVIEWER : AGENT_REPLY_SCHEMAS.REVIEWER,
      model,
      effort,
      agentType: DISPATCH_PROTOCOL.WORKER_AGENT_TYPE,
    }, work);
  }

  // Not async, and the reply is mapped in the `.then` that builds the finished record, so no microtask hop is added beyond what the frozen trace
  // table pins.
  function startAgent(launch: AgentLaunch): Promise<FinishedAgent> {
    const { key, work } = launch;
    const agentRun = 'agentModelAndEffort' in launch
      ? workerRunFor(launch.work, launch.agentModelAndEffort, launch.pausedBuildWasFoundBySurvey, launch.groupPlacement)
      : parkingAgentRunFor(launch.work);
    return agentRun.then((reply) => ({ key, work, reading: WorkflowInputUtil.finishedReadingOf(work, reply) }));
  }

  return { startAgent, runSurveyAgent };
}
