// Preloaded into the CLI (`bun --preload`) so that every "now" it reads is the story time in STORY_CLOCK.
const storyTime = process.env['STORY_CLOCK'];
if (storyTime) {
  const frozenMilliseconds = Date.parse(storyTime);
  if (Number.isNaN(frozenMilliseconds)) throw new Error(`STORY_CLOCK is not a date: ${storyTime}`);
  const OriginalDate = Date;
  const startedAtRealMilliseconds = OriginalDate.now();
  const currentStoryMilliseconds = () => frozenMilliseconds + (OriginalDate.now() - startedAtRealMilliseconds);
  class StoryDate extends OriginalDate {
    constructor(...values) {
      if (values.length === 0) super(currentStoryMilliseconds());
      else super(...values);
    }

    static now() {
      return currentStoryMilliseconds();
    }
  }
  globalThis.Date = StoryDate;
}
