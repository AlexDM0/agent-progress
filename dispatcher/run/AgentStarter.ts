/** The one place an agent is started: its prompt, its options and the mapping of its reply, for each kind of work and helper. */
import type { DispatchLogger }                        from '../@types/DispatchLogger.ts';
import type { AgentModelAndEffort, DispatchSettings } from '../@types/DispatchSettings.ts';
import type {
  AgentLaunch,
  AgentSubject,
  AgentWork,
  FinishedAgent,
  ParkWork
} from '../@types/DispatchWork.ts';
import type { AgentOptions, WorkflowRuntime } from '../@types/WorkflowRuntime.ts';
import { DISPATCH_POLICY }                    from '../constants/DispatchPolicy.ts';
import { AgentPromptUtil }                    from '../utils/AgentPromptUtil.ts';
import { DispatchWordingUtil }                from '../utils/DispatchWordingUtil.ts';
import { WorkflowInputUtil }                  from '../utils/WorkflowInputUtil.ts';
import { AGENT_REPLY_SCHEMAS }                from './constants/AgentReplySchemas.ts';

export type SurveyAgentRequest = { kind: 'survey' } | { kind: 'ticket-settings'; ticketIds: readonly string[] };

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

  function runSurveyAgent(request: SurveyAgentRequest): Promise<unknown> {
    const prompt = request.kind === 'survey' ? AgentPromptUtil.surveyPrompt(settings) : AgentPromptUtil.ticketSettingsLookupPrompt(settings, request.ticketIds);
    return runAgent(prompt, {
      label:  DispatchWordingUtil.agentLabelOf(request),
      phase:  'Survey',
      schema: request.kind === 'survey' ? AGENT_REPLY_SCHEMAS.SURVEY : AGENT_REPLY_SCHEMAS.TICKET_SETTINGS_LOOKUP,
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

  // A builder and a reviewer run on the model and effort the ticket states, and are named its owner by that model.
  function workerRunFor(work: AgentWork, agentModelAndEffort: AgentModelAndEffort, pausedBuildWasFoundBySurvey: boolean): Promise<unknown> {
    const { model, effort } = agentModelAndEffort;
    if (work.kind === 'build') {
      const prompt = AgentPromptUtil.builderPrompt(settings, {
        ticketId:     work.ticketId,
        previousPass: work.previousPass,
        owner:        model,
        pausedBuildWasFoundBySurvey,
      });
      return runAgent(prompt, {
        label:  DispatchWordingUtil.agentLabelOf(work),
        phase:  'Build',
        schema: AGENT_REPLY_SCHEMAS.BUILDER,
        model,
        effort,
      }, work);
    }
    const prompt = AgentPromptUtil.reviewerPrompt(settings, {
      ticketId:            work.ticketId,
      expectedRound:       work.round,
      rereviewRunsFirst:   work.rereviewRunsFirst,
      earlierReviewerDied: work.earlierReviewerDied,
      owner:               model,
    });
    return runAgent(prompt, {
      label:  DispatchWordingUtil.agentLabelOf(work),
      phase:  'Review',
      schema: AGENT_REPLY_SCHEMAS.REVIEWER,
      model,
      effort,
    }, work);
  }

  // Not async, and the reply is mapped in the `.then` that builds the finished record, so no microtask hop is added beyond what the frozen trace
  // table pins.
  function startAgent(launch: AgentLaunch): Promise<FinishedAgent> {
    const { key, work } = launch;
    const agentRun = 'agentModelAndEffort' in launch
      ? workerRunFor(launch.work, launch.agentModelAndEffort, launch.pausedBuildWasFoundBySurvey)
      : parkingAgentRunFor(launch.work);
    return agentRun.then((reply) => ({ key, work, reading: WorkflowInputUtil.finishedReadingOf(work, reply) }));
  }

  return { startAgent, runSurveyAgent };
}
