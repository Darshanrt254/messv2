import * as suspensionService from "../services/suspensionService.js";

export async function create(req, res, next) {
  try {
    const { customerId } = req.params;
    const actorId = req.user.id;
    const suspension = await suspensionService.createSuspension(customerId, req.body, actorId);
    return res.status(201).json({
      message: "Customer service suspended successfully.",
      suspension,
    });
  } catch (error) {
    next(error);
  }
}

export async function list(req, res, next) {
  try {
    const { customerId } = req.params;
    const suspensions = await suspensionService.listSuspensions(customerId);
    return res.status(200).json({ suspensions });
  } catch (error) {
    next(error);
  }
}

export async function unsuspend(req, res, next) {
  try {
    const { customerId, suspensionId } = req.params;
    const actorId = req.user.id;
    const result = await suspensionService.unsuspendCustomer(customerId, suspensionId, actorId);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
