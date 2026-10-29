/**
 * Questions reach User wherever User is: the open-question count leads the tab title, and a decision opened while the Bridge is up raises
 * one browser notification once User allowed them from a click. The Bridge never asks for the permission on load, and the decisions on
 * the first board it shows raise none, since User sees them there.
 */
import { useEffect, useRef } from 'react';

import type { DecisionDocument } from '../../@types/ConversationDocuments.ts';
import { QuestionsModelUtil }    from './QuestionsModel.ts';

export type NotificationAllowance = 'default' | 'granted' | 'denied' | 'unsupported';

export interface QuestionNotifier {
  readonly allowance:         () => NotificationAllowance;
  /** Asks the browser, from a click of User's; resolves to what User chose. */
  readonly askAllowance:      () => Promise<NotificationAllowance>;
  readonly notify:            (title: string, body: string) => void;
  readonly setDocumentTitle:  (title: string) => void;
  readonly baseDocumentTitle: string;
}

function browserQuestionNotifier(): QuestionNotifier {
  const supported = typeof Notification !== 'undefined';
  return {
    allowance:    () => (supported ? Notification.permission : 'unsupported'),
    askAllowance: async () => (supported ? Notification.requestPermission() : 'unsupported'),
    notify:       (title, body) => {
      if (supported && Notification.permission === 'granted') new Notification(title, { body });
    },
    setDocumentTitle: (title) => {
      document.title = title;
    },
    baseDocumentTitle: document.title,
  };
}

function notificationBodyOf(decision: DecisionDocument): string {
  return decision.questions[0]?.question ?? decision.context;
}

/** Keeps the tab title and the notifications in step with the open decisions; `null` before the first board. */
function useOpenQuestionAlerts(decisions: readonly DecisionDocument[] | null, notifier: QuestionNotifier): void {
  const seenDecisionIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (decisions === null) return;
    notifier.setDocumentTitle(QuestionsModelUtil.tabTitleOf(notifier.baseDocumentTitle, decisions.length));
    const seen = seenDecisionIds.current;
    if (seen !== null) {
      for (const decision of QuestionsModelUtil.newDecisionsOf(seen, decisions)) notifier.notify(`Question ${decision.id}`, notificationBodyOf(decision));
    }
    seenDecisionIds.current = new Set([...seen ?? [], ...decisions.map((decision) => decision.id)]);
  }, [decisions, notifier]);
}

export const QuestionAlerts = Object.freeze({ browserQuestionNotifier, useOpenQuestionAlerts });
