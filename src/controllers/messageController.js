import * as messageService from "../services/messageService.js";

export async function createCustomerMessage(req, res, next) {
  try {
    const newMessage = await messageService.createCustomerMessage(req.user.id, req.body);
    return res.status(201).json({
      message: "Message sent successfully.",
      data: newMessage,
    });
  } catch (error) {
    next(error);
  }
}

export async function listCustomerMessages(req, res, next) {
  try {
    const messages = await messageService.listMessagesForCustomer(req.user.id);
    return res.status(200).json({ messages });
  } catch (error) {
    next(error);
  }
}

export async function listOwnerMessages(req, res, next) {
  try {
    const result = await messageService.listMessagesForOwner(req.query);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateOwnerMessage(req, res, next) {
  try {
    const { messageId } = req.params;
    const actorId = req.user.id;
    const updated = await messageService.updateMessageStatusByOwner(messageId, req.body, actorId);
    return res.status(200).json({
      message: "Message updated successfully.",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}
