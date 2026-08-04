/**
 * Recreates the daily job-application trigger.
 */
function createDailyJobTrackerTrigger() {
  deleteTriggersForFunction_(
    CONFIG.TRIGGER.HANDLER_FUNCTION
  );

  ScriptApp
    .newTrigger(
      CONFIG.TRIGGER.HANDLER_FUNCTION
    )
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER.HOUR)
    .inTimezone(
      CONFIG.TRIGGER.TIME_ZONE
    )
    .create();

  console.log({
    action: "Daily trigger created",
    handler:
      CONFIG.TRIGGER.HANDLER_FUNCTION,
    hour:
      CONFIG.TRIGGER.HOUR,
    timezone:
      CONFIG.TRIGGER.TIME_ZONE
  });
}


function deleteDailyJobTrackerTrigger() {
  const deletedCount =
    deleteTriggersForFunction_(
      CONFIG.TRIGGER.HANDLER_FUNCTION
    );

  console.log({
    action: "Daily triggers removed",
    handler:
      CONFIG.TRIGGER.HANDLER_FUNCTION,
    deletedCount
  });
}


function deleteTriggersForFunction_(
  functionName
) {
  let deletedCount = 0;

  ScriptApp
    .getProjectTriggers()
    .forEach(function (trigger) {
      if (
        trigger.getHandlerFunction()
        === functionName
      ) {
        ScriptApp.deleteTrigger(trigger);
        deletedCount++;
      }
    });

  return deletedCount;
}
